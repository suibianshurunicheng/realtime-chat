import { Message, MessageType } from './entities/message.entity';

/**
 * Single serialization point from a `Message` entity to its wire view.
 * Every transport (Socket.IO today, REST later) must project through here so a
 * new column added to `Message` is reflected in exactly one place.
 *
 * Values are passed through verbatim — `createdAt`/`readAt` stay `Date`
 * instances (the transport serializes them) and `readAt` is NOT coerced to
 * `null` when unset, so the on-the-wire shape is byte-for-byte what the entity
 * holds (an unset `readAt` is omitted from the JSON payload, exactly as before).
 */
export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  type: MessageType;
  content: string;
  createdAt: Date;
  readAt: Date | null;
}

export function toMessageView(message: Message): MessageView {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    type: message.type,
    content: message.content,
    createdAt: message.createdAt,
    readAt: message.readAt,
  };
}
