import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * An established, undirected friendship. Stored as a SINGLE row per pair
 * (not mirrored A->B and B->A) to keep writes/deletes simple.
 *
 * `user_low` / `user_high` are STORED generated columns = LEAST/GREATEST of the
 * two ids. A UNIQUE key on (user_low, user_high) guarantees that an A<->B
 * friendship can never be duplicated (an A->B and a B->A row would collide).
 */
@Entity('friendships')
export class Friendship {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'bigint' })
  userId: string;

  @Column({ type: 'bigint' })
  friendId: string;

  @Column({
    type: 'bigint',
    select: false,
    generatedType: 'STORED',
    asExpression: 'LEAST(user_id, friend_id)',
  })
  userLow: string;

  @Column({
    type: 'bigint',
    select: false,
    generatedType: 'STORED',
    asExpression: 'GREATEST(user_id, friend_id)',
  })
  userHigh: string;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;
}
