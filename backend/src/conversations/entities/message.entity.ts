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
}
