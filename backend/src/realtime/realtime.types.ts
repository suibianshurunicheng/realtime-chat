/**
 * Shared types and constants for the realtime (Socket.IO) layer.
 * Socket identity is derived ONLY from the verified access token at connect time —
 * the client is never trusted to supply userId/senderId/username.
 */
export interface SocketUser {
  sub: string;
  username: string;
  jti: string;
  sid: string;
  exp?: number;
}

/** Room name for a conversation. Members auto-join their own rooms on connect. */
export const conversationRoom = (conversationId: string): string =>
  `conversation:${conversationId}`;

/** Personal room for a user. Every one of a user's sockets joins it, so a
 *  presence broadcast to `user:${fid}` reaches all of that friend's devices. */
export const userRoom = (userId: string): string => `user:${userId}`;

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
