import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
} from 'typeorm';
import type { Message } from '../../conversations/entities/message.entity';

export type AttachmentKind = 'image' | 'file';

/**
 * One uploaded file. A message may carry many attachments (1:N), and an
 * attachment is bound to exactly ONE message.
 *
 * Lifecycle:
 *  - uploaded via `POST /attachments` while still unbound (messageId = NULL,
 *    expiresAt = now + orphanTTL). At that point senderId + conversationId are
 *    already pinned (the upload happens in a conversation context).
 *  - bound to a message on send (sendMessage sets messageId, clears expiresAt).
 *    Binding is atomic (conditional update WHERE messageId IS NULL) so two
 *    concurrent sends can never consume the same attachment.
 *  - once bound, messageId is never changed again (no re-parenting, no edit).
 *
 * `storageKey` is an opaque random token — never the real filename or path.
 * `fileName` is the sanitized original name, used only for display / download
 * filename. `conversationId` is a deliberate redundancy so the download path
 * can authorize by conversation membership without loading the message first.
 *
 * FK messageId -> messages(id) ON DELETE CASCADE: deleting a message (or its
 * cascade) drops its attachments; the physical file is purged by a sweeper.
 */
@Index(['conversationId', 'createdAt'])
@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index()
  @Column({ type: 'bigint', nullable: true })
  messageId: string | null;

  @Column({ type: 'bigint' })
  conversationId: string;

  @Column({ type: 'bigint' })
  senderId: string;

  @Column({ type: 'varchar', length: 16 })
  kind: AttachmentKind;

  @Column({ type: 'varchar', length: 255 })
  fileName: string;

  @Column({ type: 'varchar', length: 255 })
  storageKey: string;

  @Column({ type: 'varchar', length: 127 })
  mimeType: string;

  @Column({ type: 'bigint' })
  fileSize: number;

  /** Image dimensions (optional). Null for files / when not parsed (Phase 4 MVP). */
  @Column({ type: 'int', nullable: true })
  width: number | null;

  @Column({ type: 'int', nullable: true })
  height: number | null;

  /** Orphan guard: unbound attachments older than this are swept. */
  @Index()
  @Column({ type: 'datetime', name: 'expires_at', nullable: true })
  expiresAt: Date | null;

  /** Soft/purge marker (set by a future purge task). */
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;

  // Lazy string relation to Message — avoids a runtime circular import with the
  // conversations module. Resolved by TypeORM at metadata-build time only.
  @ManyToOne('Message', (message: Message) => message.attachments, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  message?: Message | null;
}
