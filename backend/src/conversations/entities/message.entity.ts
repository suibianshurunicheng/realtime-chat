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
}
