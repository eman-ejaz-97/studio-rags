import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JsonWebTokenError, JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
}

/**
 * Every token says which kind it is in a typ claim. The two kinds are signed
 * with different keys already, but if both keys were ever set to the same
 * value, the claim is what stops a 30-day refresh token passing as an access
 * token, which logout could not revoke.
 */
export interface AccessTokenClaims extends AccessTokenPayload {
  typ: 'access';
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  typ: 'refresh';
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    // Copied field by field, so nothing else on the caller's object (or a typ
    // of its own) can end up inside the signed token.
    const claims: AccessTokenClaims = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      typ: 'access',
    };
    return this.jwt.signAsync(claims, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: Math.floor(this.accessTtlMs() / 1000),
    });
  }

  signRefreshToken(userId: string): Promise<{ token: string; jti: string }> {
    const jti = randomBytes(24).toString('hex');
    const claims: RefreshTokenPayload = { sub: userId, jti, typ: 'refresh' };
    return this.jwt
      .signAsync(claims, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: Math.floor(this.refreshTtlMs() / 1000),
      })
      .then((token) => ({ token, jti }));
  }

  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
    });
    // A good signature only proves which key signed it. Tokens issued before
    // the typ claim existed fail here too, which signs those sessions out once.
    if (payload.typ !== 'refresh') {
      throw new JsonWebTokenError('jwt is not a refresh token');
    }
    return payload;
  }

  /**
   * Refresh tokens are high-entropy already, so SHA-256 is the right hash here.
   * Argon2 is for passwords, where slowness is the point; running it on every
   * token refresh would only cost latency.
   */
  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  randomToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /** Milliseconds until a refresh token expires, for the cookie max-age. */
  refreshTtlMs(): number {
    return this.durationToMs(this.config.getOrThrow<string>('JWT_REFRESH_TTL'));
  }

  accessTtlMs(): number {
    return this.durationToMs(this.config.getOrThrow<string>('JWT_ACCESS_TTL'));
  }

  private durationToMs(value: string): number {
    const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
    if (!match) {
      throw new Error(
        `Unsupported duration format: "${value}". Use e.g. 15m, 30d.`,
      );
    }
    const amount = Number(match[1]);
    const unit = match[2] as 's' | 'm' | 'h' | 'd';
    const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[
      unit
    ];
    return amount * multiplier;
  }
}
