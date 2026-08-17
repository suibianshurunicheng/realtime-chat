import { io, type Socket } from 'socket.io-client';
import { useChatStore } from '../store/chat.store';
import { usePresenceStore } from '../store/presence.store';
import { useTypingStore } from '../store/typing.store';
import type {
  Message,
  TypingPayload,
  ReadReceiptPayload,
  SocketErrorPayload,
  FriendPresenceSnapshotPayload,
  PresenceUser,
  MessageRecalledPayload,
  MessageEditedPayload,
} from '../types/chat';

/**
 * Module-level Socket.IO singleton. One socket per logged-in session — never
 * recreated when switching conversations (see useChatSocket). All server events
 * are wired here ONCE at creation time and written straight into the zustand
 * stores, so React components only read state and never bind listeners.
 *
 * Token: read from the auth store at connect time via `auth: { token }`. When the
 * access token rotates (refresh), the hook tears this down and calls connectSocket
 * again with the new token — the server re-validates on every handshake.
 */

let socket: Socket | null = null;

function attach(s: Socket): void {
  const chat = useChatStore.getState;
  const presence = usePresenceStore.getState;

  s.off('connect').on('connect', () => presence().setConnection('connected'));
  s.off('disconnect').on('disconnect', () => presence().setConnection('disconnected'));
  s.off('connect_error').on('connect_error', () => presence().setConnection('disconnected'));
  s.off('reconnect_attempt').on('reconnect_attempt', () => presence().setConnection('connecting'));
  s.off('reconnect').on('reconnect', () => presence().setConnection('connected'));

  s.off('message_created').on('message_created', (msg: Message) => chat().appendMessage(msg));
  s.off('message_error').on('message_error', (err: SocketErrorPayload) => {
    chat().setError(err?.message ?? '发送失败');
  });

  s.off('friend_presence_snapshot').on('friend_presence_snapshot', (p: FriendPresenceSnapshotPayload) => {
    presence().applySnapshot(p?.users ?? []);
  });
  s.off('presence_changed').on('presence_changed', (p: PresenceUser) => {
    presence().setPresence(p.userId, p.online);
  });

  // Typing: write straight into the typing store. `typing:false` (explicit stop
  // or disconnect broadcast) clears the flag; `typing:true` refreshes the
  // receiver-side 6s watchdog inside the store.
  s.off('typing_changed').on('typing_changed', (p: TypingPayload) => {
    if (!p?.conversationId || !p?.userId) return;
    useTypingStore.getState().setTyping(p.conversationId, p.typing ? p.userId : null);
  });

  // Read receipts (Phase 3.4): the OTHER user read our messages. Mark our own
  // messages (senderId !== byUserId) read up to `upToMessageId` in the store.
  s.off('messages_read').on('messages_read', (p: ReadReceiptPayload) => {
    if (!p?.conversationId || !p?.byUserId) return;
    chat().applyReadReceipt({
      conversationId: p.conversationId,
      readerId: p.byUserId,
      upToMessageId: p.upToMessageId ?? null,
      readAt: typeof p.readAt === 'string' ? p.readAt : new Date().toISOString(),
    });
  });

  // Recall / edit (Phase 3.5): the server broadcasts these to the whole room
  // INCLUDING the actor, so both ends converge on the server result — there is
  // no optimistic local mutation anywhere in the recall/edit path.
  s.off('message_recalled').on('message_recalled', (p: MessageRecalledPayload) => {
    if (!p?.conversationId || !p?.id) return;
    chat().applyMessageRecalled({
      conversationId: p.conversationId,
      messageId: p.id,
      recalledAt: typeof p.recalledAt === 'string' ? p.recalledAt : new Date().toISOString(),
    });
  });
  s.off('message_edited').on('message_edited', (p: MessageEditedPayload) => {
    if (!p?.conversationId || !p?.id) return;
    chat().applyMessageEdited({
      conversationId: p.conversationId,
      messageId: p.id,
      content: typeof p.content === 'string' ? p.content : '',
      editedAt: typeof p.editedAt === 'string' ? p.editedAt : new Date().toISOString(),
    });
  });
}

/** Connect (idempotent singleton). Returns the existing socket if already created. */
export function connectSocket(token: string): Socket {
  if (socket) return socket;
  socket = io({
    path: '/ws',
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    transports: ['websocket', 'polling'],
  });
  attach(socket);
  return socket;
}

/** Tear down the socket (logout or token rotation). */
export function disconnectSocket(): void {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

export function getSocket(): Socket | null {
  return socket;
}

/** Emit send_message. The server echoes message_created to the room (incl. sender).
 *  For media, pass the staged `attachmentIds`; `type` is optional (the server
 *  normalizes it from the attachments, but we send it for clarity). */
export function sendSocketMessage(
  conversationId: string,
  content: string,
  attachmentIds?: string[],
  type?: 'text' | 'image' | 'file',
): void {
  if (!socket) return;
  socket.emit('send_message', { conversationId, content, attachmentIds, type });
}

/** Tell the server the local user started typing in `conversationId`. */
export function emitTypingStart(conversationId: string): void {
  if (!socket) return;
  socket.emit('typing_start', { conversationId });
}

/** Tell the server the local user stopped typing in `conversationId`. */
export function emitTypingStop(conversationId: string): void {
  if (!socket) return;
  socket.emit('typing_stop', { conversationId });
}

/** Phase 3.4: tell the server we've read messages in `conversationId` up to
 *  (and including) `upToMessageId`. The server marks only the other party's
 *  messages read and broadcasts the receipt back to them. */
export function emitRead(conversationId: string, upToMessageId?: string): void {
  if (!socket) return;
  socket.emit('read_messages', { conversationId, upToMessageId });
}

/** Phase 3.5: ask the server to recall one of MY messages. No optimistic update —
 *  the UI only changes when `message_recalled` comes back. */
export function emitRecallMessage(conversationId: string, messageId: string): void {
  if (!socket) return;
  socket.emit('recall_message', { conversationId, messageId });
}

/** Phase 3.5: ask the server to edit one of MY messages in place. No optimistic
 *  update — the UI only changes when `message_edited` comes back. */
export function emitEditMessage(
  conversationId: string,
  messageId: string,
  content: string,
): void {
  if (!socket) return;
  socket.emit('edit_message', { conversationId, messageId, content });
}
