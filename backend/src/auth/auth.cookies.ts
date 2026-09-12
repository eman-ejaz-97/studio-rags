import type { CookieOptions, Response } from 'express';

export const ACCESS_COOKIE = 'sr_access';
export const REFRESH_COOKIE = 'sr_refresh';

/**
 * The refresh cookie is scoped to the auth routes, so it is not attached to
 * every ordinary API call. Less exposure for the longer-lived credential.
 */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

function baseOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    // Lax rather than Strict: the confirmation links in our emails are
    // top-level GET navigations, and Strict would drop the session on arrival.
    sameSite: 'lax',
    secure: isProduction,
  };
}

export function setAccessCookie(
  res: Response,
  token: string,
  maxAgeMs: number,
  isProduction: boolean,
) {
  res.cookie(ACCESS_COOKIE, token, {
    ...baseOptions(isProduction),
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function setRefreshCookie(
  res: Response,
  token: string,
  maxAgeMs: number,
  isProduction: boolean,
) {
  res.cookie(REFRESH_COOKIE, token, {
    ...baseOptions(isProduction),
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
  });
}

export function clearAuthCookies(res: Response, isProduction: boolean) {
  res.clearCookie(ACCESS_COOKIE, { ...baseOptions(isProduction), path: '/' });
  res.clearCookie(REFRESH_COOKIE, {
    ...baseOptions(isProduction),
    path: REFRESH_COOKIE_PATH,
  });
}
