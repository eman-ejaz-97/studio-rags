import type { CookieOptions, Response } from 'express';
// The module object itself, so the spy below replaces what csrf.ts calls.
import crypto from 'node:crypto';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  CsrfTokenException,
  csrfTokensMatch,
  isCsrfToken,
  newCsrfToken,
  setCsrfCookie,
} from './csrf';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describe('CSRF token', () => {
  it('names the cookie sr_csrf and the header x-csrf-token', () => {
    // frontend/src/lib/session.ts reads and sends these exact names.
    expect(CSRF_COOKIE).toBe('sr_csrf');
    expect(CSRF_HEADER).toBe('x-csrf-token');
  });

  describe('newCsrfToken', () => {
    it('makes 43 base64url characters, safe in a cookie without encoding', () => {
      const token = newCsrfToken();

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(encodeURIComponent(token)).toBe(token);
    });

    it('never repeats', () => {
      const tokens = new Set(Array.from({ length: 200 }, newCsrfToken));

      expect(tokens.size).toBe(200);
    });
  });

  describe('isCsrfToken', () => {
    it('accepts what newCsrfToken makes', () => {
      expect(isCsrfToken(newCsrfToken())).toBe(true);
    });

    it.each([
      ['missing', undefined],
      ['empty', ''],
      ['too short', 'a'.repeat(42)],
      ['too long', 'a'.repeat(44)],
      ['outside base64url', `${'a'.repeat(42)}=`],
      ['not a string', 42],
    ])('refuses a value that is %s', (_label, value) => {
      expect(isCsrfToken(value)).toBe(false);
    });
  });

  describe('csrfTokensMatch', () => {
    const token = newCsrfToken();

    it('passes when the header repeats the cookie', () => {
      expect(csrfTokensMatch(token, token)).toBe(true);
    });

    it('fails with no header', () => {
      expect(csrfTokensMatch(token, undefined)).toBe(false);
    });

    it('fails with no cookie', () => {
      expect(csrfTokensMatch(undefined, token)).toBe(false);
    });

    it('fails when the header differs, at any length', () => {
      expect(csrfTokensMatch(token, newCsrfToken())).toBe(false);
      expect(csrfTokensMatch(token, token.slice(1))).toBe(false);
      expect(csrfTokensMatch(token, `${token}x`)).toBe(false);
      expect(csrfTokensMatch(token, '')).toBe(false);
    });

    it('fails for a matching pair the API never issued, such as "1" and "1"', () => {
      expect(csrfTokensMatch('1', '1')).toBe(false);
    });

    it('compares in constant time, so timing reveals nothing of the token', () => {
      const compare = jest.spyOn(crypto, 'timingSafeEqual');

      csrfTokensMatch(token, token);

      expect(compare).toHaveBeenCalledTimes(1);
      compare.mockRestore();
    });
  });

  describe('setCsrfCookie', () => {
    function fakeResponse() {
      return { cookie: jest.fn<unknown, [string, string, CookieOptions]>() };
    }

    it('sets a lax, site-wide cookie that page JavaScript can read', () => {
      const res = fakeResponse();

      setCsrfCookie(
        res as unknown as Response,
        'the-token',
        THIRTY_DAYS_MS,
        false,
      );

      expect(res.cookie).toHaveBeenCalledWith('sr_csrf', 'the-token', {
        httpOnly: false,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: THIRTY_DAYS_MS,
      });
    });

    it.each([
      [true, true],
      [false, false],
    ])(
      'marks it Secure only in production (production=%p)',
      (isProd, secure) => {
        const res = fakeResponse();

        setCsrfCookie(res as unknown as Response, 't', 1000, isProd);

        expect(res.cookie.mock.calls[0][2].secure).toBe(secure);
      },
    );
  });

  it('refuses with a 403 that says what to do, in words', () => {
    const error = new CsrfTokenException();

    expect(error.getStatus()).toBe(403);
    expect(error.message).toBe(
      "This request did not carry this site's security token. Reload the page and try again.",
    );
  });
});
