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
