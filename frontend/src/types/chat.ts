import type { User } from './user';

/** Mirrors backend `ConversationView` (conversations.service.ts). */
export interface ConversationView {
  id: string;
  type: 'direct';
  createdAt: string;
  updatedAt: string;
  members: User[];
}

/** Mirrors backend `Message` entity (text only in this phase). */
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  type: 'text';
  content: string;
  createdAt: string;
  /** Recipient read time (ISO string) or null = unread. Phase 3.4. */
  readAt: string | null;
}

/** Mirrors backend presence payload `{ userId, online }`. */
export interface PresenceUser {
  userId: string;
  online: boolean;
}

/** Mirrors backend `typing_changed` payload (realtime gateway). */
export interface TypingPayload {
  conversationId: string;
  userId: string;
  typing: boolean;
}

/** Mirrors backend `ReadReceiptPayload` (realtime `messages_read` event). */
export interface ReadReceiptPayload {
  conversationId: string;
  byUserId: string;
  upToMessageId: string | null;
  readAt: string;
}

/** Mirrors backend `ErrorEnvelope` (realtime `message_error` event). */
export interface SocketErrorPayload {
  code: number;
  message: string;
}

/** Mirrors backend `friend_presence_snapshot` payload (realtime gateway). */
export interface FriendPresenceSnapshotPayload {
  users?: PresenceUser[];
}

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected';

/** Mirrors backend `FriendRequestStatus`. */
export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

/** Mirrors backend `FriendRequestView` (friends.service.ts listReceived). */
export interface FriendRequestView {
  id: string;
  requester: User;
  addresseeId: string;
  status: FriendRequestStatus;
  createdAt: string;
}
