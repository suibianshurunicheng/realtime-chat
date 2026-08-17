import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type MessageType = 'text';

/**
 * A chat message. Phase 2.2A supports `text` only (image/file/audio/video/system
 * are explicitly out of scope and reserved for later phases).
 *
 * FK conversationId -> conversations, FK senderId -> users. The (conversationId,
 * created_at) index supports cursor-based history pagination.
 *
 * `readAt` (Phase 3.4, nullable) records when the message's RECIPIENT first read
 * it. In a 1:1 conversation the recipient is exactly the non-sender member, so a
 * single column suffices — no `message_reads` table. Null = unread. Server-
 * generated only (never trusted from the client).
 *
 * `recalledAt` / `editedAt` (Phase 3.5, nullable) are server-generated markers:
 * - recalledAt != null  -> the sender recalled the message. `content` KEEPS the
 *   original text in the DB (audit), but every public projection must blank it
 *   out (see `toMessageView`) so no transport can leak it.
 * - editedAt != null    -> the sender edited the message in place; `content`
 *   holds the latest text. No edit history is stored (by design).
 * Neither has a time window (recall/edit are allowed forever) and neither is
 * indexed (both are read as part of an already-located row).
 */
@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'bigint' })
  conversationId: string;

  @Column({ type: 'bigint' })
  senderId: string;

  @Column({ type: 'varchar', length: 16, default: 'text' })
  type: MessageType;

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;

  /** Recipient read timestamp (set by ConversationsService.markRead). Null = unread. */
  @Column({ type: 'datetime', name: 'read_at', nullable: true })
  readAt: Date | null;

  /**
   * Recall timestamp (set by ConversationsService.recallMessage). Null = not
   * recalled. Original `content` is deliberately preserved in the DB; public
   * views blank it.
   */
  @Column({ type: 'datetime', name: 'recalled_at', nullable: true })
  recalledAt: Date | null;

  /** Last edit timestamp (set by ConversationsService.editMessage). Null = never edited. */
  @Column({ type: 'datetime', name: 'edited_at', nullable: true })
  editedAt: Date | null;
}
