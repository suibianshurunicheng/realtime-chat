/**
 * Shared types and constants for the realtime (Socket.IO) layer.
 * Socket identity is derived ONLY from the verified access token at connect time —
 * the client is never trusted to supply userId/senderId/username.
 */

/** Identity pinned to `socket.data.user` after token verification. */
export interface SocketUser {
  sub: string;
  username: string;
  jti: string;
  sid: string;
  exp?: number;
}

/* ------------------------------------------------------------------ *
 * Socket event naming rules (documented contract — NOT enforced in code)
 * ------------------------------------------------------------------ *
 *  - Server -> Client events describe a fact in the past tense:
 *      `noun_past`  e.g. message_created, messages_read, typing_changed,
 *                    presence_changed, friend_presence_snapshot
 *  - Client -> Server events describe an intent in the imperative:
 *      `verb_object`  e.g. send_message, read_messages, typing_start,
 *                     typing_stop
 *  - The error channel is a single S->C event: `message_error`.
 *
 * Existing event names are FROZEN — do not rename them (that would be a
 * breaking change for already-shipped clients). New events follow the rules
 * above.
 *
 * Error-handling rules (documented contract):
 *  - BUSINESS events (send_message / read_messages) report failures to the
 *    originating socket ONLY, via the `message_error` event. The broadcast
 *    path never throws to the room.
 *  - EPHEMERAL events (typing_start / typing_stop) fail silently: an invalid
 *    or unauthorized payload is dropped (no error event, no broadcast). They
 *    carry no business state, so there is nothing to report.
 * ------------------------------------------------------------------ */

/** Standard error shape for the `message_error` event. Business-rule failures
 *  (membership, validation, persistence) are reported via this event. */
export interface ErrorEnvelope {
  code: number;
  message: string;
}

/** Room name for a conversation. Members auto-join their own rooms on connect. */
export const conversationRoom = (conversationId: string): string =>
  `conversation:${conversationId}`;

/** Personal room for a user. Every one of a user's sockets joins it, so a
 *  presence broadcast to `user:${fid}` reaches all of that friend's devices. */
export const userRoom = (userId: string): string => `user:${userId}`;

/** Client -> Server: the user sent a message in `conversationId`. */
export const SEND_MESSAGE_EVENT = 'send_message';

export const MESSAGE_CREATED_EVENT = 'message_created';
export const MESSAGE_ERROR_EVENT = 'message_error';

/** An online/offline state actually changed for `userId` (0↔1 sockets). */
export const PRESENCE_CHANGED_EVENT = 'presence_changed';

/** Sent once to a socket right after connect: the online state of that user's friends. */
export const FRIEND_PRESENCE_SNAPSHOT_EVENT = 'friend_presence_snapshot';

/** Client -> Server: the user started typing in `conversationId`. */
export const TYPING_START_EVENT = 'typing_start';

/** Client -> Server: the user stopped typing in `conversationId`. */
export const TYPING_STOP_EVENT = 'typing_stop';

/** Server -> Client: someone's typing state changed in a conversation room. */
export const TYPING_CHANGED_EVENT = 'typing_changed';

/** Client -> Server: the user read messages in `conversationId` up to `upToMessageId`. */
export const READ_MESSAGES_EVENT = 'read_messages';

/** Server -> Client: a read receipt — `byUserId` read the OTHER party's messages. */
export const MESSAGES_READ_EVENT = 'messages_read';
