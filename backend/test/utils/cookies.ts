import type { Response } from 'supertest';

export interface SetCookie {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  /** Seconds, as sent on the wire. */
  maxAge?: number;
  expires?: Date;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
}

/**
 * Parses every Set-Cookie header on a response, attributes included, so tests
 * assert what the browser is actually told rather than trusting the helper
 * that wrote it. Throws if one response sets the same cookie twice, since the
 * browser would only keep the last and the test would be guessing which.
 */
export function parseSetCookies(res: Response): Map<string, SetCookie> {
  const cookies = new Map<string, SetCookie>();

  for (const header of res.get('Set-Cookie') ?? []) {
    const [pair, ...attributes] = header.split(';').map((part) => part.trim());
    const eq = pair.indexOf('=');
    const cookie: SetCookie = {
      name: pair.slice(0, eq),
      value: decodeURIComponent(pair.slice(eq + 1)),
      httpOnly: false,
      secure: false,
    };

    for (const attribute of attributes) {
      const [rawKey, ...rest] = attribute.split('=');
      const key = rawKey.toLowerCase();
      const value = rest.join('=');
      if (key === 'path') cookie.path = value;
      else if (key === 'domain') cookie.domain = value;
      else if (key === 'max-age') cookie.maxAge = Number(value);
      else if (key === 'expires') cookie.expires = new Date(value);
      else if (key === 'httponly') cookie.httpOnly = true;
      else if (key === 'secure') cookie.secure = true;
      else if (key === 'samesite') cookie.sameSite = value;
    }

    if (cookies.has(cookie.name)) {
      throw new Error(`Response sets cookie "${cookie.name}" more than once`);
    }
    cookies.set(cookie.name, cookie);
  }

  return cookies;
}

/** The named cookie, or a failed test saying which one was missing. */
export function getSetCookie(res: Response, name: string): SetCookie {
  const cookie = parseSetCookies(res).get(name);
  if (!cookie) {
    throw new Error(
      `Expected a Set-Cookie for "${name}"; got: ${(res.get('Set-Cookie') ?? []).join(' | ') || 'none'}`,
    );
  }
  return cookie;
}

/**
 * A browser deletes a cookie when told to store an empty value that has
 * already expired, and only if Path matches the original. A clear with the
 * wrong Path leaves the real cookie in place, so callers pass the path.
 */
export function expectCleared(res: Response, name: string, path: string) {
  const cookie = getSetCookie(res, name);
  expect(cookie.value).toBe('');
  expect(cookie.path).toBe(path);
  expect(cookie.expires?.getTime()).toBeLessThanOrEqual(Date.now());
  expect(cookie.httpOnly).toBe(true);
}
