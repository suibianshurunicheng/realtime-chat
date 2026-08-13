import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Membership of a user in a conversation. One row per (conversation, user).
 *
 * UNIQUE(conversationId, userId): a user can never be a member twice in the
 * same conversation (no orphan / duplicate rows). `userId` is also indexed for
 * the "list my conversations" query.
 */
@Entity('conversation_members')
export class ConversationMember {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'bigint' })
  conversationId: string;

  @Column({ type: 'bigint' })
  userId: string;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;
}
