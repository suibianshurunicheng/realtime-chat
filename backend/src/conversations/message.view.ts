import { Message, MessageType } from './entities/message.entity';
import type { Attachment } from '../attachments/entities/attachment.entity';
import { toAttachmentView, AttachmentView } from '../attachments/attachment.view';

/**
 * Placeholder that replaces the body of a recalled message in EVERY public
 * projection. The DB row keeps the original text (audit), but no transport
 * (Socket.IO broadcasts, REST history, …) may expose it — clients render their
 * own localized "message recalled" label off `recalledAt`, so an empty string is
 * enough and stays language-agnostic.
 */
export const RECALLED_CONTENT_PLACEHOLDER = '';

/**
 * Single serialization point from a `Message` entity to its wire view.
 * Every transport (Socket.IO and REST history) must project through here so a
 * new column added to `Message` is reflected in exactly one place — and so the
 * recall redaction below can never be bypassed.
 *
 * Values are passed through verbatim — `createdAt`/`readAt`/`recalledAt`/
 * `editedAt` stay `Date` instances (the transport serializes them) and they are
 * NOT coerced to `null` when unset, so the on-the-wire shape is byte-for-byte
 * what the entity holds (an unset `readAt` is omitted from the JSON payload,
 * exactly as before).
 *
 * The ONE deliberate exception: when `recalledAt` is set, `content` is replaced
 * by `RECALLED_CONTENT_PLACEHOLDER`. This is the security-relevant part of Phase
 * 3.5 — the original text must never leave the server once recalled.
 */
export interface MessageView {
  id: string;
  conversationId: string;
  senderId: string;
  type: MessageType;
  content: string;
  createdAt: Date;
  readAt: Date | null;
  recalledAt: Date | null;
  editedAt: Date | null;
  /** Phase 4: attached media (empty for text messages). */
  attachments: AttachmentView[];
}

export function toMessageView(message: Message): MessageView {
  const recalled = message.recalledAt != null;
  const attachments = ((message as { attachments?: Attachment[] }).attachments ?? []) as Attachment[];
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    type: message.type,
    // Recalled -> never leak the stored original text.
    content: recalled ? RECALLED_CONTENT_PLACEHOLDER : message.content,
    createdAt: message.createdAt,
    readAt: message.readAt,
    recalledAt: message.recalledAt,
    editedAt: message.editedAt,
    attachments: attachments.map(toAttachmentView),
  };
}
