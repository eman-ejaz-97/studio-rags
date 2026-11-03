import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ACCESS_COOKIE } from '../auth.cookies';
import type { AccessTokenClaims } from '../token.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      // Cookie first: the browser client keeps the token in an httpOnly cookie
      // so XSS cannot read it. The Bearer fallback exists for API tooling.
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request): string | null => {
          const cookies = req?.cookies as
            Record<string, string | undefined> | undefined;
          return cookies?.[ACCESS_COOKIE] ?? null;
        },
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  /**
   * Runs only after the signature and expiry have been checked. The typ check
   * is what keeps a refresh token out if both JWT secrets were ever the same
   * value; validateEnv refuses that at boot, and this is the second line.
   */
  validate(payload: AccessTokenClaims): AuthenticatedUser {
    if (!payload?.sub || payload.typ !== 'access') {
      throw new UnauthorizedException();
    }
    return { id: payload.sub, email: payload.email, role: payload.role };
  }
}
