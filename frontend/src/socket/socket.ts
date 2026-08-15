import { io, type Socket } from 'socket.io-client';
import { useChatStore } from '../store/chat.store';
import { usePresenceStore } from '../store/presence.store';
import { useTypingStore } from '../store/typing.store';
import type { Message, TypingPayload } from '../types/chat';

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

interface SocketError {
  code: number;
  message: string;
}

function attach(s: Socket): void {
  const chat = useChatStore.getState;
  const presence = usePresenceStore.getState;

  s.off('connect').on('connect', () => presence().setConnection('connected'));
  s.off('disconnect').on('disconnect', () => presence().setConnection('disconnected'));
  s.off('connect_error').on('connect_error', () => presence().setConnection('disconnected'));
  s.off('reconnect_attempt').on('reconnect_attempt', () => presence().setConnection('connecting'));
  s.off('reconnect').on('reconnect', () => presence().setConnection('connected'));

  s.off('message_created').on('message_created', (msg: Message) => chat().appendMessage(msg));
  s.off('message_error').on('message_error', (err: SocketError) => {
    chat().setError(err?.message ?? '发送失败');
  });

  s.off('friend_presence_snapshot').on('friend_presence_snapshot', (p: { users?: { userId: string; online: boolean }[] }) => {
    presence().applySnapshot(p?.users ?? []);
  });
  s.off('presence_changed').on('presence_changed', (p: { userId: string; online: boolean }) => {
    presence().setPresence(p.userId, p.online);
  });

  // Typing: write straight into the typing store. `typing:false` (explicit stop
  // or disconnect broadcast) clears the flag; `typing:true` refreshes the
  // receiver-side 6s watchdog inside the store.
  s.off('typing_changed').on('typing_changed', (p: TypingPayload) => {
    if (!p?.conversationId || !p?.userId) return;
    useTypingStore.getState().setTyping(p.conversationId, p.typing ? p.userId : null);
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

/** Emit send_message. The server echoes message_created to the room (incl. sender). */
export function sendSocketMessage(conversationId: string, content: string): void {
  if (!socket) return;
  socket.emit('send_message', { conversationId, content });
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
