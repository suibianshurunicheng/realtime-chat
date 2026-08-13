import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { FriendRequest, FriendRequestStatus } from './entities/friend-request.entity';
import { Friendship } from './entities/friendship.entity';
import type { PublicUser } from '../users/users.service';

export interface FriendRequestView {
  id: string;
  requester: PublicUser;
  addresseeId: string;
  status: FriendRequestStatus;
  createdAt: Date;
}

@Injectable()
export class FriendsService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(FriendRequest)
    private readonly requests: Repository<FriendRequest>,
    @InjectRepository(Friendship)
    private readonly friendships: Repository<Friendship>,
  ) {}

  private toPublic(u: User): PublicUser {
    return {
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      avatar: u.avatar,
      status: u.status,
      createdAt: u.createdAt,
    };
  }

  async sendRequest(me: string, addresseeId: string): Promise<FriendRequest> {
    if (me === addresseeId) {
      throw new BadRequestException('不能添加自己为好友');
    }
    const addressee = await this.users.findOne({ where: { id: addresseeId } });
    if (!addressee) {
      throw new NotFoundException('目标用户不存在');
    }
    if (await this.findFriendship(me, addresseeId)) {
      throw new ConflictException('已经是好友');
    }
    const pending = await this.requests.findOne({
      where: { requesterId: me, addresseeId, status: 'pending' },
    });
    if (pending) {
      throw new ConflictException('已存在待处理的好友申请');
    }
    const req = this.requests.create({
      requesterId: me,
      addresseeId,
      status: 'pending',
    });
    try {
      return await this.requests.save(req);
    } catch (err) {
      // Concurrent send raced past the read check and hit the unique constraint.
      if (err instanceof QueryFailedError && (err as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new ConflictException('已存在待处理的好友申请');
      }
      throw err;
    }
  }

  async listReceived(me: string): Promise<FriendRequestView[]> {
    const rows = await this.requests.find({
      where: { addresseeId: me, status: 'pending' },
      order: { createdAt: 'DESC' },
    });
    const requesterIds = [...new Set(rows.map((r) => r.requesterId))];
    const users = requesterIds.length
      ? await this.users.findByIds(requesterIds)
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return rows.map((r) => ({
      id: r.id,
      requester: byId.get(r.requesterId)
        ? this.toPublic(byId.get(r.requesterId)!)
        : ({} as PublicUser),
      addresseeId: r.addresseeId,
      status: r.status,
      createdAt: r.createdAt,
    }));
  }

  async accept(me: string, requestId: string): Promise<{ request: FriendRequest }> {
    const req = await this.requests.findOne({ where: { id: requestId } });
    if (!req) {
      throw new NotFoundException('好友申请不存在');
    }
    if (req.addresseeId !== me) {
      throw new ForbiddenException('无权操作该好友申请');
    }
    if (req.status !== 'pending') {
      throw new ConflictException('申请已处理');
    }
    if (await this.findFriendship(me, req.requesterId)) {
      throw new ConflictException('已经是好友');
    }
    const friendship = this.friendships.create({
      userId: me,
      friendId: req.requesterId,
    });
    try {
      await this.friendships.save(friendship);
    } catch (err) {
      // Concurrent accept (or duplicate) — treat as already friends.
      if (err instanceof QueryFailedError && (err as { code?: string }).code === 'ER_DUP_ENTRY') {
        throw new ConflictException('已经是好友');
      }
      throw err;
    }
    req.status = 'accepted';
    await this.requests.save(req);
    return { request: req };
  }

  async reject(me: string, requestId: string): Promise<{ request: FriendRequest }> {
    const req = await this.requests.findOne({ where: { id: requestId } });
    if (!req) {
      throw new NotFoundException('好友申请不存在');
    }
    if (req.addresseeId !== me) {
      throw new ForbiddenException('无权操作该好友申请');
    }
    if (req.status !== 'pending') {
      throw new ConflictException('申请已处理');
    }
    req.status = 'rejected';
    await this.requests.save(req);
    return { request: req };
  }

  /** Requester cancels their own still-pending request. */
  async cancel(me: string, requestId: string): Promise<void> {
    const req = await this.requests.findOne({ where: { id: requestId } });
    if (!req) {
      throw new NotFoundException('好友申请不存在');
    }
    if (req.requesterId !== me) {
      throw new ForbiddenException('只能取消自己发出的好友申请');
    }
    if (req.status !== 'pending') {
      throw new ConflictException('申请已处理');
    }
    await this.requests.delete({ id: req.id });
  }

  async listFriends(me: string): Promise<PublicUser[]> {
    const friendIds = await this.listFriendIds(me);
    if (!friendIds.length) return [];
    const users = await this.users.findByIds(friendIds);
    return users.map((u) => this.toPublic(u));
  }

  /** Bare friend-id list (no user join). Used by the realtime presence layer to
   *  decide who may receive presence broadcasts — keeps relationship queries in
   *  FriendsService while PresenceService owns the online state. */
  async listFriendIds(me: string): Promise<string[]> {
    const rows = await this.friendships
      .createQueryBuilder('f')
      .where('f.userId = :me OR f.friendId = :me', { me })
      .getMany();
    return [
      ...new Set(
        rows.map((r) => (r.userId === me ? r.friendId : r.userId)),
      ),
    ];
  }

  async removeFriend(me: string, friendId: string): Promise<void> {
    if (me === friendId) {
      throw new BadRequestException('不能删除自己');
    }
    const friendship = await this.findFriendship(me, friendId);
    if (!friendship) {
      throw new NotFoundException('好友关系不存在');
    }
    await this.friendships.delete({ id: friendship.id });
  }

  private findFriendship(a: string, b: string): Promise<Friendship | null> {
    return this.friendships
      .createQueryBuilder('f')
      .where(
        '(f.userId = :a AND f.friendId = :b) OR (f.userId = :b AND f.friendId = :a)',
        { a, b },
      )
      .getOne();
  }
}
