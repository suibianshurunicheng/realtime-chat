import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected';

/**
 * A directed friend request: `requester` asks `addressee` to be friends.
 * The row is kept after resolution (accepted/rejected) as history; `friendships`
 * is the source of truth for an established relationship.
 *
 * `pending_flag` is a VIRTUAL generated column (1 only while `status='pending'`).
 * It is part of a UNIQUE key together with (requester_id, addressee_id): because
 * MySQL unique indexes ignore NULL, this permits at most ONE pending request per
 * directed pair while still allowing accepted/rejected history rows to coexist.
 */
@Entity('friend_requests')
export class FriendRequest {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'bigint' })
  requesterId: string;

  @Column({ type: 'bigint' })
  addresseeId: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: FriendRequestStatus;

  @Column({
    type: 'tinyint',
    nullable: true,
    select: false,
    generatedType: 'VIRTUAL',
    asExpression: '(CASE WHEN status = \'pending\' THEN 1 ELSE NULL END)',
  })
  pendingFlag: number | null;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt: Date;
}
