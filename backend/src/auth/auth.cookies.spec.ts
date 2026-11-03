import type { CookieOptions, Response } from 'express';
import express from 'express';
import request from 'supertest';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
  clearAuthCookies,
  setAccessCookie,
  setRefreshCookie,
} from './auth.cookies';

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function fakeResponse() {
  return {
    cookie: jest.fn<unknown, [string, string, CookieOptions]>(),
    clearCookie: jest.fn<unknown, [string, CookieOptions]>(),
  };
}

type FakeResponse = ReturnType<typeof fakeResponse>;

const asResponse = (res: FakeResponse) => res as unknown as Response;

describe('auth cookies', () => {
  it('names the cookies sr_access and sr_refresh', () => {
    // The web client and JwtStrategy both depend on these exact names.
    expect(ACCESS_COOKIE).toBe('sr_access');
    expect(REFRESH_COOKIE).toBe('sr_refresh');
  });

  describe('setAccessCookie', () => {
    it('sets an httpOnly, lax, site-wide cookie that lives as long as the token', () => {
      const res = fakeResponse();

      setAccessCookie(asResponse(res), 'access-token', ACCESS_TTL_MS, false);

      expect(res.cookie).toHaveBeenCalledWith('sr_access', 'access-token', {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        maxAge: ACCESS_TTL_MS,
      });
    });

    it.each([
      [true, true],
      [false, false],
    ])(
      'marks it Secure only in production (production=%p)',
      (isProd, secure) => {
        const res = fakeResponse();

        setAccessCookie(asResponse(res), 'access-token', ACCESS_TTL_MS, isProd);

        expect(res.cookie.mock.calls[0][2].secure).toBe(secure);
      },
    );
  });

  describe('setRefreshCookie', () => {
    it('scopes the cookie to exactly /api/v1/auth', () => {
      const res = fakeResponse();

      setRefreshCookie(asResponse(res), 'refresh-token', REFRESH_TTL_MS, true);

      expect(REFRESH_COOKIE_PATH).toBe('/api/v1/auth');
      expect(res.cookie).toHaveBeenCalledWith('sr_refresh', 'refresh-token', {
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/api/v1/auth',
        maxAge: REFRESH_TTL_MS,
      });
    });
  });

  describe('clearAuthCookies', () => {
    // A browser only deletes a cookie when the clearing Set-Cookie names the
    // same path (and domain) it was set with. Anything else is silently
    // ignored and the user stays signed in after "logging out".
    it.each([true, false])(
      'clears both cookies with the path and domain they were set with (production=%p)',
      (isProd) => {
        const res = fakeResponse();
        setAccessCookie(asResponse(res), 'a', ACCESS_TTL_MS, isProd);
        setRefreshCookie(asResponse(res), 'r', REFRESH_TTL_MS, isProd);

        clearAuthCookies(asResponse(res), isProd);

        const scopeOf = (options: CookieOptions) => ({
          path: options.path,
          domain: options.domain,
        });
        const set = new Map(
          res.cookie.mock.calls.map(([name, , opts]) => [name, scopeOf(opts)]),
        );
        const cleared = new Map(
          res.clearCookie.mock.calls.map(([name, opts]) => [
            name,
            scopeOf(opts),
          ]),
        );

        expect([...cleared.keys()].sort()).toEqual(['sr_access', 'sr_refresh']);
        expect(cleared.get('sr_access')).toEqual(set.get('sr_access'));
        expect(cleared.get('sr_refresh')).toEqual(set.get('sr_refresh'));
      },
    );

    it('keeps the same Secure and SameSite flags when clearing', () => {
      const res = fakeResponse();

      clearAuthCookies(asResponse(res), true);

      for (const [, options] of res.clearCookie.mock.calls) {
        expect(options).toMatchObject({
          httpOnly: true,
          sameSite: 'lax',
          secure: true,
        });
      }
    });
  });

  // The same round trip through real Express, which is what
  // @nestjs/platform-express serves with, checking the headers a browser sees.
  describe('Set-Cookie headers', () => {
    const app = express();
    app.get('/set', (_req, res) => {
      setAccessCookie(res, 'access-token', ACCESS_TTL_MS, true);
      setRefreshCookie(res, 'refresh-token', REFRESH_TTL_MS, true);
      res.end();
    });
    app.get('/clear', (_req, res) => {
      clearAuthCookies(res, true);
      res.end();
    });

    function parseSetCookies(headers: Record<string, string>) {
      const lines = headers['set-cookie'] as unknown as string[];
      return new Map(
        lines.map((line) => {
          const [pair, ...attributes] = line.split(';').map((p) => p.trim());
          const name = pair.slice(0, pair.indexOf('='));
          const value = pair.slice(pair.indexOf('=') + 1);
          const attrs = Object.fromEntries(
            attributes.map((a) => {
              const [key, ...rest] = a.split('=');
              return [key.toLowerCase(), rest.length ? rest.join('=') : true];
            }),
          ) as Record<string, string | true>;
          return [name, { value, attrs }];
        }),
      );
    }

    it('sets both cookies, then expires both on the same paths', async () => {
      const setRes = await request(app).get('/set');
      const clearRes = await request(app).get('/clear');
      const set = parseSetCookies(setRes.headers);
      const cleared = parseSetCookies(clearRes.headers);

      expect(set.get('sr_access')?.attrs).toMatchObject({
        path: '/',
        httponly: true,
        secure: true,
        samesite: 'Lax',
        'max-age': String(ACCESS_TTL_MS / 1000),
      });
      expect(set.get('sr_refresh')?.attrs).toMatchObject({
        path: '/api/v1/auth',
        'max-age': String(REFRESH_TTL_MS / 1000),
      });

      for (const name of ['sr_access', 'sr_refresh']) {
        const clearing = cleared.get(name);
        expect(clearing?.value).toBe('');
        expect(clearing?.attrs.path).toBe(set.get(name)?.attrs.path);
        expect(
          new Date(String(clearing?.attrs.expires)).getTime(),
        ).toBeLessThan(Date.now());
      }
    });
  });
});
