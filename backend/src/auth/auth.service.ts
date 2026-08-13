import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { UsersService, PublicUser } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { TokenService } from './token.service';
import { RedisService } from '../redis/redis.service';
import { TokenSocketRegistry } from '../realtime/token-socket.registry';

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly token: TokenService,
    private readonly redis: RedisService,
    private readonly registry: TokenSocketRegistry,
  ) {}

  /** Issue a fresh access + refresh pair for `user` under session `sid`.
   *  `sid` is stable for the session: login/register create one, refresh reuses it
   *  (only the refresh value rotates), avoiding orphaned Redis keys. */
  private async issueTokens(user: User, sid: string): Promise<AuthResult> {
    const accessToken = await this.token.signAccessToken({
      sub: user.id,
      username: user.username,
      sid,
    });
    const refreshToken = this.token.generateRefreshToken();
    const hash = this.token.hashRefreshToken(refreshToken);
    await this.redis.saveRefreshHash(user.id, sid, hash);
    return { accessToken, refreshToken, user: this.users.toPublic(user) };
  }

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.users.findByUsername(dto.username);
    if (existing) {
      throw new ConflictException('用户名已存在');
    }
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.users.create(dto.username, passwordHash, dto.nickname);
    return this.issueTokens(user, randomUUID());
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.users.findByUsernameWithPassword(dto.username);
    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (user.status === 'disabled') {
      throw new UnauthorizedException('账号已被禁用');
    }
    return this.issueTokens(user, randomUUID());
  }

  async refresh(userId: string, sid: string, refreshToken: string): Promise<AuthResult> {
    const hash = this.token.hashRefreshToken(refreshToken);
    const stored = await this.redis.getRefreshHash(userId, sid);
    if (!stored || stored !== hash) {
      throw new UnauthorizedException('refresh token 无效或已失效');
    }
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    if (user.status === 'disabled') {
      throw new UnauthorizedException('账号已被禁用');
    }
    // Same sid: only the refresh value rotates, the session id stays stable.
    return this.issueTokens(user, sid);
  }

  /**
   * Logout one session: drop its refresh key, blacklist its access token (until
   * natural expiry), then revoke any live Socket.IO connections that authenticated
   * with that access token. Order is deliberate — blacklist FIRST, revoke AFTER —
   * so there is no window where a freshly-revoked socket could reconnect. The
   * blacklist is the security source of truth; the revoke is best-effort teardown
   * and is guarded so it can never roll back the blacklist or fail the request.
   */
  async logout(userId: string, sid: string, jti: string, ttlSeconds: number): Promise<void> {
    await this.redis.deleteRefresh(userId, sid);
    await this.redis.addToBlacklist(jti, ttlSeconds);
    try {
      const n = this.registry.revoke(jti);
      if (n > 0) {
        this.logger.log(`logout revoked ${n} socket(s) userId=${userId} sid=${sid} jti=${jti}`);
      }
    } catch (err) {
      // A socket teardown failure must NOT undo the blacklist or fail logout.
      this.logger.error(
        `logout socket revoke failed userId=${userId} jti=${jti}: ${err instanceof Error ? err.stack : String(err)}`,
      );
    }
  }
}
