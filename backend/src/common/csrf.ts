import { ForbiddenException } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Response } from 'express';

/**
 * The double-submit CSRF token (SPEC § 3, ADR-003). The API sets a random
 * value in this cookie, page JavaScript reads it, and the website sends it
 * back in CSRF_HEADER on every request that changes something. CsrfGuard
 * refuses the request unless the two match.
 *
 * Another site can make a visitor's browser send our cookies, but it cannot
 * read them, and it cannot add a custom header to a cross-site request
 * without our CORS approval. So only pages on our own address can make the
 * pair match. This works because the browser talks to the API on the
 * website's own address (ADR-026), where page JavaScript can read the cookie.
 */
export const CSRF_COOKIE = 'sr_csrf';

/** Where the website echoes the cookie's value (frontend/src/lib/session.ts). */
export const CSRF_HEADER = 'x-csrf-token';

/**
 * The problem type of the 403 for a missing or wrong token. The website
 * checks for it to tell this refusal apart from any other 403, and answers
 * it by fetching a fresh token and trying once more. A tag: URI (RFC 4151)
 * names the problem without promising a web page at that address.
 */
export const CSRF_PROBLEM_TYPE = 'tag:studio-rags.vercel.app,2026:csrf-token';

/** What a visitor might read if the website cannot recover on its own. */
export const CSRF_REFUSED =
  "This request did not carry this site's security token. Reload the page and try again.";

/** 32 random bytes in base64url: 43 characters from A-Z, a-z, 0-9, - and _. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function newCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/** True for a value of the shape newCsrfToken() makes. */
export function isCsrfToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_SHAPE.test(value);
}

/**
 * Whether the header repeats the cookie. The cookie must also look like one
 * of ours, so a pair such as "1" and "1" never passes.
 */
export function csrfTokensMatch(
  cookie: unknown,
  header: string | undefined,
): boolean {
  if (!isCsrfToken(cookie) || header === undefined) return false;
  const given = Buffer.from(header);
  const wanted = Buffer.from(cookie);
  // timingSafeEqual throws on buffers of different lengths. Checking the
  // length first gives away only the length, which every token shares.
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/**
 * Not httpOnly, unlike the auth cookies: page JavaScript has to read it to
 * copy it into the header. That gives a script on our pages nothing new,
 * since such a script could send requests from the page anyway. Path=/ so
 * every page on the site can read it, not only /api/v1.
 */
export function setCsrfCookie(
  res: Response,
  token: string,
  maxAgeMs: number,
  isProduction: boolean,
) {
  const options: CookieOptions = {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: maxAgeMs,
  };
  res.cookie(CSRF_COOKIE, token, options);
}

/** Thrown by CsrfGuard; CsrfExceptionFilter turns it into problem+json. */
export class CsrfTokenException extends ForbiddenException {
  constructor() {
    super(CSRF_REFUSED);
  }
}
