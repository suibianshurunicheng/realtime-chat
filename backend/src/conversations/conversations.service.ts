import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Friendship } from '../friends/entities/friendship.entity';
import { Conversation, ConversationType } from './entities/conversation.entity';
import { ConversationMember } from './entities/conversation-member.entity';
import { Message } from './entities/message.entity';
import type { PublicUser } from '../users/users.service';

export interface ConversationView {
  id: string;
  type: ConversationType;
  createdAt: Date;
  updatedAt: Date;
  members: PublicUser[];
}

const MAX_PAGE_LIMIT = 50;
const DEFAULT_PAGE_LIMIT = 30;

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(ConversationMember)
    private readonly members: Repository<ConversationMember>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Friendship)
    private readonly friendships: Repository<Friendship>,
  ) {}

  private toPublic(u: User): PublicUser {
    return {
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      avatar: u.avatar,
      status: u.status,
      createdAt: u.createdAt,
    };
  }

  /** True when a and b are mutual friends (either direction). */
  private async areFriends(a: string, b: string): Promise<boolean> {
    const f = await this.friendships
      .createQueryBuilder('f')
      .where(
        '(f.userId = :a AND f.friendId = :b) OR (f.userId = :b AND f.friendId = :a)',
        { a, b },
      )
      .getOne();
    return !!f;
  }

  private orderedPair(a: string, b: string): [string, string] {
    // Numeric compare on bigint ids; stable across A->B / B->A.
    return BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  }

  /**
   * Create-or-get a 1:1 conversation between `me` and `otherId`.
   * Rules: both must exist, not self, and must already be friends.
   * Concurrent creation is made safe by UNIQUE(userLow, userHigh): a collision
   * is caught and the already-existing conversation is returned (no 500).
   */
  async createDirect(me: string, otherId: string): Promise<ConversationView> {
    if (me === otherId) {
      throw new BadRequestException('不能和自己创建会话');
    }
    const other = await this.users.findOne({ where: { id: otherId } });
    if (!other) {
      throw new NotFoundException('对方用户不存在');
    }
    if (!(await this.areFriends(me, otherId))) {
      throw new ForbiddenException('仅好友之间可以发起会话');
    }

    const [low, high] = this.orderedPair(me, otherId);
    const existing = await this.conversations.findOne({
      where: { userLow: low, userHigh: high },
    });
    if (existing) {
      return this.buildView(existing);
    }

    const conv = this.conversations.create({
      type: 'direct',
      userLow: low,
      userHigh: high,
    });

    try {
      const saved = await this.conversations.manager.transaction(async (mgr) => {
        const c = await mgr.save(Conversation, conv);
        await mgr.save(ConversationMember, { conversationId: c.id, userId: me });
        await mgr.save(ConversationMember, { conversationId: c.id, userId: otherId });
        return c;
      });
      return this.buildView(saved);
    } catch (err) {
      // Another request won the race and inserted the same pair first.
      if (err instanceof QueryFailedError && (err as { code?: string }).code === 'ER_DUP_ENTRY') {
        const winner = await this.conversations.findOne({
          where: { userLow: low, userHigh: high },
        });
        if (winner) return this.buildView(winner);
      }
      throw err;
    }
  }

  async listMine(me: string): Promise<ConversationView[]> {
    const myMembers = await this.members.find({ where: { userId: me } });
    if (!myMembers.length) return [];
    const convs = await this.conversations.findByIds(
      myMembers.map((m) => m.conversationId),
    );
    return Promise.all(convs.map((c) => this.buildView(c)));
  }

  /** Lightweight list of conversation ids the user belongs to (no member/user joins).
   *  Used by the realtime layer to auto-join Socket.IO rooms. */
  async listConversationIds(me: string): Promise<string[]> {
    const myMembers = await this.members.find({ where: { userId: me } });
    return myMembers.map((m) => m.conversationId);
  }

  /** Detail by id; 404 if missing, 403 if `me` is not a member. */
  async getOne(me: string, conversationId: string): Promise<ConversationView> {
    const conv = await this.conversations.findOne({ where: { id: conversationId } });
    if (!conv) {
      throw new NotFoundException('会话不存在');
    }
    if (!(await this.isMember(conversationId, me))) {
      throw new ForbiddenException('你不是该会话的成员');
    }
    return this.buildView(conv);
  }

  /** Cursor-paginated history (oldest first within the page). `before` is a message id. */
  async getMessages(
    me: string,
    conversationId: string,
    limit?: string,
    before?: string,
  ): Promise<Message[]> {
    await this.assertMember(conversationId, me);
    const take = Math.min(Math.max(parseInt(limit ?? '', 10) || DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.conversationId = :cid', { cid: conversationId });
    if (before) {
      qb.andWhere('m.id < :before', { before });
    }
    const rows = await qb
      .orderBy('m.id', 'DESC')
      .limit(take)
      .getMany();
    rows.reverse(); // ascending (chronological) for stable rendering
    return rows;
  }

  /**
   * Send a text message. `senderId` is ALWAYS `me` (from the JWT) — the client
   * body is never trusted for it. 404 if conversation missing, 403 if not a member.
   */
  async sendMessage(me: string, conversationId: string, content: string): Promise<Message> {
    const conv = await this.conversations.findOne({ where: { id: conversationId } });
    if (!conv) {
      throw new NotFoundException('会话不存在');
    }
    await this.assertMember(conversationId, me);
    const msg = this.messages.create({
      conversationId,
      senderId: me,
      type: 'text',
      content,
    });
    return this.messages.save(msg);
  }

  private async isMember(conversationId: string, userId: string): Promise<boolean> {
    const m = await this.members.findOne({
      where: { conversationId, userId },
    });
    return !!m;
  }

  private async assertMember(conversationId: string, userId: string): Promise<void> {
    if (!(await this.isMember(conversationId, userId))) {
      throw new ForbiddenException('你不是该会话的成员');
    }
  }

  private async buildView(conv: Conversation): Promise<ConversationView> {
    const memberRows = await this.members.find({
      where: { conversationId: conv.id },
    });
    const userIds = memberRows.map((m) => m.userId);
    const users = userIds.length ? await this.users.findByIds(userIds) : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    const members = userIds
      .map((id) => (byId.get(id) ? this.toPublic(byId.get(id)!) : null))
      .filter((u): u is PublicUser => u !== null);
    return {
      id: conv.id,
      type: conv.type,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      members,
    };
  }
}
