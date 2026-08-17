import type { User } from './user';

/** Mirrors backend `ConversationView` (conversations.service.ts). */
export interface ConversationView {
  id: string;
  type: 'direct';
  createdAt: string;
  updatedAt: string;
  members: User[];
}

/** Mirrors backend `AttachmentView` (attachments/attachment.view.ts). */
export interface AttachmentView {
  id: string;
  kind: 'image' | 'file';
  fileName: string;
  mimeType: string;
  fileSize: number;
  width?: number | null;
  height?: number | null;
  /** Opaque, auth-gated URL (`/attachments/:id`). Never a real path. */
  url: string;
}

/** Mirrors backend `MessageView` (message.view.ts). */
export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  type: 'text' | 'image' | 'file';
  /**
   * Latest body. For media messages this is the optional caption. When
   * `recalledAt` is set the server sends an empty string here (the original
   * text never leaves the backend), so the UI must render its own "已撤回"
   * placeholder off `recalledAt` and NEVER off `content`.
   */
  content: string;
  createdAt: string;
  /** Recipient read time (ISO string) or null = unread. Phase 3.4. */
  readAt: string | null;
  /** Recall time (ISO string) or null = not recalled. Phase 3.5. */
  recalledAt: string | null;
  /** Last edit time (ISO string) or null = never edited. Phase 3.5. */
  editedAt: string | null;
  /** Phase 4: attached media (undefined/empty for text messages). */
  attachments?: AttachmentView[];
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

/**
 * Payload of the Phase 3.5 `message_recalled` / `message_edited` events. Both
 * carry a full `MessageView`, so the store patches the row it already holds
 * instead of reconstructing it.
 */
export type MessageRecalledPayload = Message;
export type MessageEditedPayload = Message;

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
