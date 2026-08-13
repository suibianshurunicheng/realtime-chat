import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AppConfig } from '../../config/configuration';
import { RedisService } from '../../redis/redis.service';

interface AccessPayload {
  sub: string;
  username: string;
  jti: string;
  sid: string;
  exp?: number;
}

/**
 * Custom JWT guard (decision D7): verifies the Bearer access token directly with @nestjs/jwt
 * rather than passport. Also rejects tokens present in the access-blacklist (revoked before
 * natural expiry, e.g. after logout). Attaches `{ sub, username, jti, sid, exp }` to `req.user`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig>,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('未提供访问令牌');
    }
    const token = header.slice('Bearer '.length);
    const secret = this.config.get('jwt.accessSecret', { infer: true });
    let payload: AccessPayload;
    try {
      payload = this.jwt.verify<AccessPayload>(token, { secret });
    } catch {
      throw new UnauthorizedException('访问令牌无效或已过期');
    }
    if (await this.redis.isBlacklisted(payload.jti)) {
      throw new UnauthorizedException('访问令牌已失效');
    }
    (req as Request & { user?: AccessPayload }).user = {
      sub: payload.sub,
      username: payload.username,
      jti: payload.jti,
      sid: payload.sid,
      exp: payload.exp,
    };
    return true;
  }
}
