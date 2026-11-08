import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  CsrfTokenException,
  csrfTokensMatch,
} from '../csrf';
import { CSRF_EXEMPT_KEY } from '../decorators/csrf-exempt.decorator';

/** Methods that only read. Every other method must carry the token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Applied globally. Every request that can change something must repeat the
 * CSRF cookie in the x-csrf-token header (common/csrf.ts). That includes
 * sign-in and registration, so another site cannot sign a visitor in to an
 * account of its own choosing either. A route opts out with @CsrfExempt().
 *
 * Runs before JwtAuthGuard, so a forged request is refused before any
 * session is looked at.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;

    const exempt = this.reflector.getAllAndOverride<boolean>(CSRF_EXEMPT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return true;

    const cookie: unknown = req.cookies?.[CSRF_COOKIE];
    if (!csrfTokensMatch(cookie, req.get(CSRF_HEADER))) {
      throw new CsrfTokenException();
    }
    return true;
  }
}
