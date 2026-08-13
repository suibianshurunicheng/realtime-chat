import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Thin wrapper around the shared ioredis client.
 * Refresh tokens are stored per session under `auth:refresh:{userId}:{sid}` (EX = refresh TTL),
 * so a single user can hold multiple concurrent sessions (multi-device). Revocation is per-session.
 * Revoked access tokens live in `auth:access:blacklist:{jti}` (EX = remaining access lifetime).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    private readonly config: ConfigService<AppConfig>,
  ) {}

  onModuleDestroy(): void {
    void this.client.quit();
  }

  private refreshKey(userId: string | number, sid: string): string {
    return `auth:refresh:${userId}:${sid}`;
  }

  /** Store the SHA-256 hash of a refresh token for a specific session. Original is only sent to the client as an httpOnly cookie. */
  async saveRefreshHash(
    userId: string | number,
    sid: string,
    tokenHash: string,
  ): Promise<void> {
    const ttlDays = this.config.get('jwt.refreshExpiresInDays', { infer: true }) ?? 7;
    await this.client.set(this.refreshKey(userId, sid), tokenHash, 'EX', ttlDays * 86400);
  }

  async getRefreshHash(userId: string | number, sid: string): Promise<string | null> {
    return this.client.get(this.refreshKey(userId, sid));
  }

  /** Revoke a single session's refresh token (e.g. logout from one device). */
  async deleteRefresh(userId: string | number, sid: string): Promise<void> {
    await this.client.del(this.refreshKey(userId, sid));
  }

  private blacklistKey(jti: string): string {
    return `auth:access:blacklist:${jti}`;
  }

  /** Reject a logged-out/invalidated access token before it naturally expires. TTL = remaining lifetime. */
  async addToBlacklist(jti: string, ttlSeconds: number): Promise<void> {
    if (ttlSeconds <= 0) return;
    await this.client.set(this.blacklistKey(jti), '1', 'EX', ttlSeconds);
  }

  async isBlacklisted(jti: string): Promise<boolean> {
    return (await this.client.exists(this.blacklistKey(jti))) === 1;
  }

  async ping(): Promise<string> {
    return this.client.ping();
  }
}
