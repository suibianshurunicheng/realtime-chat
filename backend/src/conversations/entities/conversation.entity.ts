import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ConversationType = 'direct' | 'group';

/**
 * A chat conversation.
 *
 * For a `direct` (1:1) conversation the two participants are stored in the
 * ordered pair `userLow`/`userHigh` (= LEAST/GREATEST of the two user ids).
 * A UNIQUE key on (userLow, userHigh) guarantees that A->B and B->A always
 * resolve to the SAME conversation — a race on concurrent creation collides
 * here instead of producing two rows (handled in ConversationsService).
 *
 * `userLow`/`userHigh` are NULL for group conversations (future phase), where
 * the unique rule no longer applies.
 */
@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'varchar', length: 16, default: 'direct' })
  type: ConversationType;

  @Column({ type: 'bigint', nullable: true })
  userLow: string | null;

  @Column({ type: 'bigint', nullable: true })
  userHigh: string | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt: Date;
}
