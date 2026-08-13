import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';

export interface AccessTokenPayload {
  sub: string;
  username: string;
  /** Stable session/device id, used to scope the refresh token and revoke per-session. */
  sid: string;
}

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  /** Sign a short-lived access token. `expiresIn` comes from JwtModule signOptions.
   *  A unique `jti` is attached so every issuance is distinct (rotation, traceability). */
  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync({ ...payload, jti: randomUUID() });
  }

  /** Opaque, unguessable refresh token (never stored in clear text). */
  generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  /** SHA-256 of the refresh token — only this hash is stored in Redis. */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Decode (do NOT verify) an access token even if expired, to recover `sub` for rotation. */
  decodeExpired(token: string): AccessTokenPayload | null {
    try {
      return this.jwt.decode(token) as AccessTokenPayload;
    } catch {
      return null;
    }
  }
}
