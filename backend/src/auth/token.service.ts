import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  signAccessToken(payload: AccessTokenPayload): Promise<string> {
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: Math.floor(this.accessTtlMs() / 1000),
    });
  }

  signRefreshToken(userId: string): Promise<{ token: string; jti: string }> {
    const jti = randomBytes(24).toString('hex');
    return this.jwt
      .signAsync(
        { sub: userId, jti },
        {
          secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
          expiresIn: Math.floor(this.refreshTtlMs() / 1000),
        },
      )
      .then((token) => ({ token, jti }));
  }

  verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    return this.jwt.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
    });
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
