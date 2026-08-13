import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

export interface PublicUser {
  id: string;
  username: string;
  nickname: string;
  avatar: string | null;
  status: User['status'];
  createdAt: Date;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  async create(username: string, passwordHash: string, nickname: string): Promise<User> {
    const user = this.repo.create({ username, passwordHash, nickname });
    return this.repo.save(user);
  }

  findByUsername(username: string): Promise<User | null> {
    return this.repo.findOne({ where: { username } });
  }

  /** Login needs the hash, which is excluded by `select: false` on the entity. */
  findByUsernameWithPassword(username: string): Promise<User | null> {
    return this.repo.findOne({
      where: { username },
      select: ['id', 'username', 'passwordHash', 'nickname', 'status', 'avatar', 'createdAt'],
    });
  }

  findById(id: string): Promise<User | null> {
    return this.repo.findOne({ where: { id } });
  }

  toPublic(user: User): PublicUser {
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar,
      status: user.status,
      createdAt: user.createdAt,
    };
  }

  async getPublicById(id: string): Promise<PublicUser> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return this.toPublic(user);
  }

  /** Search users by username/nickname, excluding the caller. Parameterized (no SQL injection). */
  async search(me: string, q: string): Promise<PublicUser[]> {
    const term = q.trim();
    if (!term) return [];
    const found = await this.repo
      .createQueryBuilder('u')
      .where('u.id != :me', { me })
      .andWhere('(u.username LIKE :q OR u.nickname LIKE :q)', { q: `%${term}%` })
      .orderBy('u.created_at', 'DESC')
      .limit(20)
      .getMany();
    return found.map((u) => this.toPublic(u));
  }
}
