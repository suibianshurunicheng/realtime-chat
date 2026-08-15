import { Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { HttpException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RedisService } from '../redis/redis.service';
import { ConversationsService } from '../conversations/conversations.service';
import { FriendsService } from '../friends/friends.service';
import { PresenceService } from './presence.service';
import { TokenSocketRegistry } from './token-socket.registry';
import { Message } from '../conversations/entities/message.entity';
import { AppConfig } from '../config/configuration';
import {
  SocketUser,
  conversationRoom,
  userRoom,
  MESSAGE_CREATED_EVENT,
  MESSAGE_ERROR_EVENT,
  PRESENCE_CHANGED_EVENT,
  FRIEND_PRESENCE_SNAPSHOT_EVENT,
  TYPING_START_EVENT,
  TYPING_STOP_EVENT,
  TYPING_CHANGED_EVENT,
  READ_MESSAGES_EVENT,
  MESSAGES_READ_EVENT,
} from './realtime.types';
import { SendSocketMessageDto } from './dto/send-socket-message.dto';
import { TypingDto } from './dto/typing.dto';
import { ReadMessagesDto } from './dto/read-messages.dto';

interface AccessPayload {
  sub: string;
  username: string;
  jti: string;
  sid: string;
  exp?: number;
}

interface ErrorEnvelope {
  code: number;
  message: string;
}

/**
 * Socket.IO gateway (Phase 2.2B + 2.3A). Single-instance, in-process broadcast only —
 * no Redis adapter / Pub/Sub (deliberately out of scope; see deliverable doc).
 *
 * Auth flow: a connection middleware verifies the access token (signature +
 * expiry via @nestjs/jwt, Redis blacklist, user existence) BEFORE the socket is
 * accepted. The verified identity is pinned to `socket.data.user` and is the
 * only source of sender identity.
 *
 * Lifecycle:
 *  - connect  → join conversation rooms + own user room → PresenceService.connect →
 *               broadcast `presence_changed` to friends *only if* the user flipped
 *               offline→online → push a `friend_presence_snapshot` to this socket.
 *  - disconnect → PresenceService.disconnect → broadcast `presence_changed` to friends
 *               *only if* the user flipped online→offline.
 *
 * Business rules for messaging (conversation existence, membership, sender, persistence)
 * are delegated to `ConversationsService.sendMessage` — the exact same method the REST
 * controller calls, so there is a single code path.
 */
@Injectable()
@WebSocketGateway({
  path: '/ws',
  cors: {
    // Read directly from env (mirrors configuration.ts) so the decorator stays static.
    origin: (process.env.RTC_CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig>,
    private readonly redis: RedisService,
    private readonly users: UsersService,
    private readonly conversations: ConversationsService,
    private readonly friends: FriendsService,
    private readonly presence: PresenceService,
    private readonly registry: TokenSocketRegistry,
  ) {}

  /** Register the connection-time auth middleware + the logout revoker.
   *  Failures in `authenticate` reach the client as `connect_error`. The revoker
   *  is the ONLY place that holds the `Server`, so the registry (a pure index)
   *  asks it to force-disconnect sockets on logout. */
  afterInit(server: Server): void {
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (err) => next(err instanceof Error ? err : new Error('UNAUTHORIZED')),
      );
    });
    this.registry.setRevoker((socketIds: string[]) => {
      for (const id of socketIds) {
        const sock = server.sockets.sockets.get(id);
        const u = sock?.data?.user as SocketUser | undefined;
        // Log identity by jti/sid only — never the raw token.
        this.logger.log(
          `revoke socket on logout socketId=${id} userId=${u?.sub} sid=${u?.sid} jti=${u?.jti} reason=logout`,
        );
        sock?.disconnect(true);
      }
    });
  }

  private async authenticate(socket: Socket): Promise<void> {
    const raw =
      (socket.handshake.auth?.token as string | undefined) ??
      this.bearerToken(socket.handshake.headers.authorization);
    if (!raw) throw new Error('UNAUTHORIZED');
    const token = raw.replace(/^Bearer\s+/i, '');
    const secret = this.config.get('jwt.accessSecret', { infer: true });

    let payload: AccessPayload;
    try {
      payload = this.jwt.verify<AccessPayload>(token, { secret });
    } catch {
      throw new Error('TOKEN_INVALID');
    }
    if (await this.redis.isBlacklisted(payload.jti)) {
      throw new Error('TOKEN_BLACKLISTED');
    }
    const user = await this.users.findById(payload.sub);
    if (!user) throw new Error('USER_NOT_FOUND');

    const identity: SocketUser = {
      sub: payload.sub,
      username: payload.username,
      jti: payload.jti,
      sid: payload.sid,
      exp: payload.exp,
    };
    socket.data.user = identity;
  }

  private bearerToken(header: string | string[] | undefined): string | undefined {
    if (!header) return undefined;
    const value = Array.isArray(header) ? header[0] : header;
    return value.startsWith('Bearer ') ? value.slice('Bearer '.length) : value;
  }

  async handleConnection(client: Socket): Promise<void> {
    const user = client.data.user as SocketUser | undefined;
    if (!user) {
      // Middleware should have rejected; guard anyway.
      client.disconnect(true);
      return;
    }
    this.logger.log(`socket connected socketId=${client.id} userId=${user.sub}`);
    // Bind this socket to its access-token jti for token-scoped logout revocation.
    this.registry.register(user.jti, client.id);
    try {
      const ids = await this.conversations.listConversationIds(user.sub);
      for (const id of ids) {
        // socket.join is synchronous in socket.io v4; rooms are ready before `connect` is acked.
        client.join(conversationRoom(id));
      }
      // Own user room — presence broadcasts to friends land here for every device.
      client.join(userRoom(user.sub));

      // Presence: flip offline→online *only if* this is the user's first live socket.
      const result = this.presence.connect(user.sub, client.id);
      if (result.changed) {
        await this.broadcastPresence(user.sub, true);
      }

      // Initial snapshot: tell this client who among its friends is currently online.
      const friendIds = await this.friends.listFriendIds(user.sub);
      const snapshot = this.presence.getStatuses(friendIds);
      client.emit(FRIEND_PRESENCE_SNAPSHOT_EVENT, { users: snapshot });
    } catch (err) {
      // A transient DB error during connect must NOT crash the whole gateway
      // process (an unhandled rejection would kill every in-flight socket/test).
      // Roll back the in-memory binding and close this socket cleanly instead.
      this.logger.error(
        `handleConnection failed socketId=${client.id} userId=${user.sub}: ${err instanceof Error ? err.stack : String(err)}`,
      );
      try {
        this.registry.unregister(user.jti, client.id);
      } catch {
        /* defensive */
      }
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const user = client.data.user as SocketUser | undefined;
    if (!user) {
      this.logger.log(
        `socket disconnected(fallback) socketId=${client.id} userId=-`,
      );
      return;
    }
    this.logger.log(`socket disconnected socketId=${client.id} userId=${user.sub}`);

    // Registry cleanup — independent of presence so a failure in one path can
    // never block the other. Both are idempotent.
    try {
      this.registry.unregister(user.jti, client.id);
    } catch (err) {
      this.logger.error(
        `registry.unregister failed socketId=${client.id}: ${err instanceof Error ? err.stack : String(err)}`,
      );
    }

    // Presence: flip online→offline *only if* this was the user's last live socket.
    const result = this.presence.disconnect(user.sub, client.id);
    if (result.changed) {
      void this.broadcastPresence(user.sub, false);
    }

    // Third-layer typing cleanup: a socket leaving (tab close / network drop /
    // logout) must never leave a peer stuck on "对方正在输入...". Broadcast
    // `typing:false` for the user across every conversation they were in. The
    // receiver's own 6s timeout is the backup; this is the authoritative signal.
    // Failure here must never block the disconnect path above.
    void this.broadcastTypingStopOnDisconnect(user.sub, client.id);
  }

  private async broadcastTypingStopOnDisconnect(
    userId: string,
    socketId: string,
  ): Promise<void> {
    try {
      const ids = await this.conversations.listConversationIds(userId);
      for (const id of ids) {
        // The leaving socket may already be out of the room; `.except` is a
        // harmless no-op then — every other peer in the room still gets the reset.
        this.server
          .to(conversationRoom(id))
          .except(socketId)
          .emit(TYPING_CHANGED_EVENT, {
            conversationId: id,
            userId,
            typing: false,
          });
      }
    } catch (err) {
      this.logger.error(
        `broadcastTypingStopOnDisconnect failed userId=${userId}: ${err instanceof Error ? err.stack : String(err)}`,
      );
    }
  }

  /** Notify each of `userId`'s friends via their personal room. Only currently
   *  connected friends receive it (an empty room is a silent no-op). */
  private async broadcastPresence(userId: string, online: boolean): Promise<void> {
    const friendIds = await this.friends.listFriendIds(userId);
    if (!friendIds.length) return;
    const payload = { userId, online };
    for (const fid of friendIds) {
      this.server.to(userRoom(fid)).emit(PRESENCE_CHANGED_EVENT, payload);
    }
  }

  @SubscribeMessage('send_message')
  async onSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    const user = client.data.user as SocketUser | undefined;
    if (!user) {
      client.emit(MESSAGE_ERROR_EVENT, { code: 401, message: '未认证' } as ErrorEnvelope);
      return;
    }

    const dto = plainToInstance(SendSocketMessageDto, body ?? {});
    const errors = await validate(dto);
    if (errors.length > 0) {
      client.emit(MESSAGE_ERROR_EVENT, { code: 400, message: '消息格式非法' } as ErrorEnvelope);
      return;
    }

    let msg: Message;
    try {
      // Single shared path with REST: membership + sender + persistence enforced here.
      msg = await this.conversations.sendMessage(user.sub, dto.conversationId, dto.content);
    } catch (err) {
      client.emit(MESSAGE_ERROR_EVENT, this.toErrorEnvelope(err));
      return;
    }

    const payload = {
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      type: msg.type,
      content: msg.content,
      createdAt: msg.createdAt,
      readAt: msg.readAt,
    };
    // Broadcast to the room — sender included, so A and B receive the identical event.
    this.server.to(conversationRoom(dto.conversationId)).emit(MESSAGE_CREATED_EVENT, payload);
  }

  /**
   * Client -> Server: the user has read messages in `conversationId` up to (and
   * including) `upToMessageId` (or all unread if omitted). We mark only the OTHER
   * party's messages as read (never the caller's own) using a server timestamp,
   * then broadcast `messages_read` to the room MINUS the caller so the sender of
   * those messages sees the receipt. Re-marking is a no-op (`WHERE readAt IS NULL`).
   */
  @SubscribeMessage(READ_MESSAGES_EVENT)
  async onReadMessages(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    const user = client.data.user as SocketUser | undefined;
    if (!user) {
      client.emit(MESSAGE_ERROR_EVENT, { code: 401, message: '未认证' } as ErrorEnvelope);
      return;
    }

    const dto = plainToInstance(ReadMessagesDto, body ?? {});
    const errors = await validate(dto);
    if (errors.length > 0) {
      client.emit(MESSAGE_ERROR_EVENT, { code: 400, message: '消息格式非法' } as ErrorEnvelope);
      return;
    }

    let result;
    try {
      // Single shared path with REST: membership + direction + persistence.
      result = await this.conversations.markRead(user.sub, dto.conversationId, dto.upToMessageId);
    } catch (err) {
      client.emit(MESSAGE_ERROR_EVENT, this.toErrorEnvelope(err));
      return;
    }

    const payload = {
      conversationId: result.conversationId,
      byUserId: result.byUserId,
      upToMessageId: result.upToMessageId,
      readAt: result.readAt,
    };
    // Only the sender of the read messages (the other party) should receive the
    // receipt — the caller who triggered it must not see its own echo.
    this.server
      .to(conversationRoom(dto.conversationId))
      .except(client.id)
      .emit(MESSAGES_READ_EVENT, payload);
  }

  /**
   * Client -> Server: the user started/stopped typing. Ephemeral state only —
   * never persisted. We confirm socket identity (`client.data.user`), validate
   * the payload, and check conversation membership before broadcasting a
   * `typing_changed` event to every OTHER socket in the conversation room.
   * `except(client.id)` guarantees the sender never receives its own echo.
   */
  @SubscribeMessage(TYPING_START_EVENT)
  async onTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    await this.broadcastTyping(client, body, true);
  }

  @SubscribeMessage(TYPING_STOP_EVENT)
  async onTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: unknown,
  ): Promise<void> {
    await this.broadcastTyping(client, body, false);
  }

  private async broadcastTyping(
    client: Socket,
    body: unknown,
    typing: boolean,
  ): Promise<void> {
    const user = client.data.user as SocketUser | undefined;
    if (!user) return;

    const dto = plainToInstance(TypingDto, body ?? {});
    const errors = await validate(dto);
    if (errors.length > 0) return;

    // Membership is enforced against the verified identity — the client is never
    // trusted to declare whose typing state it broadcasts.
    if (!(await this.conversations.isMember(dto.conversationId, user.sub))) {
      return;
    }

    const payload = {
      conversationId: dto.conversationId,
      userId: user.sub,
      typing,
    };
    // Broadcast to the room minus the sender. A non-member room join is impossible
    // here because only members were joined to `conversationRoom` at connect time.
    this.server
      .to(conversationRoom(dto.conversationId))
      .except(client.id)
      .emit(TYPING_CHANGED_EVENT, payload);
  }

  private toErrorEnvelope(err: unknown): ErrorEnvelope {
    if (err instanceof HttpException) {
      const status = err.getStatus();
      const resp = err.getResponse();
      let message = err.message;
      if (resp && typeof resp === 'object' && 'message' in resp) {
        const m = (resp as Record<string, unknown>).message;
        message = Array.isArray(m) ? (m as string[]).join('; ') : String(m);
      }
      return { code: status, message };
    }
    this.logger.error(
      `unhandled send_message error: ${err instanceof Error ? err.stack : String(err)}`,
    );
    return { code: 500, message: '服务器内部错误' };
  }
}
