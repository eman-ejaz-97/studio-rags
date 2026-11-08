import { Controller, Delete, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../src/auth/auth.cookies';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  CSRF_PROBLEM_TYPE,
  isCsrfToken,
  newCsrfToken,
} from '../src/common/csrf';
import { CsrfExempt } from '../src/common/decorators/csrf-exempt.decorator';
import { Public } from '../src/common/decorators/public.decorator';
import { AUTH, PASSWORD, register, registerBody } from './utils/auth';
import { getSetCookie, parseSetCookies } from './utils/cookies';
import { useTestApp } from './utils/test-app';

const CONTACT = '/api/v1/contact';
const PROBE = '/api/v1/csrf-probe';
const THIRTY_DAYS_S = 30 * 24 * 60 * 60;

/**
 * Routes the app does not have yet, mounted behind the real global guards:
 * PUT, PATCH and DELETE, an exempted POST standing in for the Stripe
 * webhook, and a write that needs a session.
 */
@Public()
@Controller('csrf-probe')
class CsrfProbeController {
  @Put()
  @HttpCode(200)
  put() {
    return { ok: true };
  }

  @Patch()
  @HttpCode(200)
  patch() {
    return { ok: true };
  }

  @Delete()
  @HttpCode(200)
  remove() {
    return { ok: true };
  }

  @CsrfExempt()
  @Post('webhook')
  @HttpCode(200)
  webhook() {
    return { received: true };
  }
}

@Controller('csrf-probe/signed-in')
class SignedInProbeController {
  @Post()
  @HttpCode(200)
  write() {
    return { ok: true };
  }
}

const enquiry = {
  name: 'Jane Citizen',
  email: 'jane@example.com',
  message: 'Do you run batik classes on weekends?',
};

describe('CSRF double-submit token (e2e)', () => {
  const ctx = useTestApp({
    controllers: [CsrfProbeController, SignedInProbeController],
  });

  /** A write sent the way a browser on our own pages sends it. */
  const withPair = (cookie: string, header: string) => ({
    Cookie: `${CSRF_COOKIE}=${cookie}`,
    [CSRF_HEADER]: header,
  });

  describe('the guard', () => {
    it('refuses a write with no token, as problem+json, before the handler runs', async () => {
      const t = ctx();

      const res = await t.httpWithoutCsrf().post(CONTACT).send(enquiry);

      expect(res.status).toBe(403);
      expect(res.get('Content-Type')).toMatch(/^application\/problem\+json/);
      expect(JSON.parse(res.text)).toMatchObject({
        type: CSRF_PROBLEM_TYPE,
        status: 403,
        detail: expect.stringContaining('Reload the page') as unknown,
      });
      await expect(t.prisma.enquiry.count()).resolves.toBe(0);
    });

    it('refuses a header that does not match the cookie', async () => {
      const t = ctx();

      await t
        .httpWithoutCsrf()
        .post(CONTACT)
        .set(withPair(newCsrfToken(), newCsrfToken()))
        .send(enquiry)
        .expect(403);
      await expect(t.prisma.enquiry.count()).resolves.toBe(0);
    });

    it('refuses a header with no cookie, and a cookie with no header', async () => {
      const token = newCsrfToken();

      await ctx()
        .httpWithoutCsrf()
        .post(CONTACT)
        .set(CSRF_HEADER, token)
        .send(enquiry)
        .expect(403);
      await ctx()
        .httpWithoutCsrf()
        .post(CONTACT)
        .set('Cookie', `${CSRF_COOKIE}=${token}`)
        .send(enquiry)
        .expect(403);
    });

    it('refuses a matching pair the API could never have issued', async () => {
      await ctx()
        .httpWithoutCsrf()
        .post(CONTACT)
        .set(withPair('1', '1'))
        .send(enquiry)
        .expect(403);
    });

    it('accepts a header that repeats the cookie', async () => {
      const t = ctx();
      const token = newCsrfToken();

      await t
        .httpWithoutCsrf()
        .post(CONTACT)
        .set(withPair(token, token))
        .send(enquiry)
        .expect(202);
      await expect(t.prisma.enquiry.count()).resolves.toBe(1);
    });

    it('covers sign-in, so another site cannot sign a visitor in to its own account', async () => {
      const t = ctx();
      await register(t);
      await t.prisma.refreshToken.deleteMany();

      const res = await t
        .httpWithoutCsrf()
        .post(`${AUTH}/login`)
        .send({ email: 'ada@example.com', password: PASSWORD })
        .expect(403);

      expect(parseSetCookies(res).has(ACCESS_COOKIE)).toBe(false);
      await expect(t.prisma.refreshToken.count()).resolves.toBe(0);
    });

    it('covers registration', async () => {
      const t = ctx();

      await t
        .httpWithoutCsrf()
        .post(`${AUTH}/register`)
        .send(registerBody())
        .expect(403);
      await expect(t.prisma.user.count()).resolves.toBe(0);
    });

    it.each(['put', 'patch', 'delete'] as const)(
      'covers %s as well as POST',
      async (method) => {
        const token = newCsrfToken();

        await ctx().httpWithoutCsrf()[method](PROBE).expect(403);
        await ctx()
          .httpWithoutCsrf()
          [method](PROBE)
          .set(withPair(token, token))
          .expect(200);
      },
    );

    it('lets a @CsrfExempt() route through with no cookie and no header, as Stripe will call the webhook', async () => {
      const res = await ctx()
        .httpWithoutCsrf()
        .post(`${PROBE}/webhook`)
        .expect(200);

      expect(res.body).toEqual({ received: true });
    });

    it('leaves reads alone', async () => {
      const t = ctx();

      await t.httpWithoutCsrf().get('/api/v1/health').expect(200);
      await t.httpWithoutCsrf().get('/api/v1/workshops').expect(200);
      // 401 from the session check, not 403: no token was asked for.
      await t.httpWithoutCsrf().get(`${AUTH}/me`).expect(401);
    });

    it('checks the token before the session', async () => {
      const token = newCsrfToken();

      await ctx().httpWithoutCsrf().post(`${PROBE}/signed-in`).expect(403);
      await ctx()
        .httpWithoutCsrf()
        .post(`${PROBE}/signed-in`)
        .set(withPair(token, token))
        .expect(401);
    });
  });

  describe('GET /api/v1/auth/csrf', () => {
    it('issues a token that pages can read, for the whole site, not stored by caches', async () => {
      const res = await ctx().httpWithoutCsrf().get(`${AUTH}/csrf`).expect(200);

      const cookie = getSetCookie(res, CSRF_COOKIE);
      expect(isCsrfToken(cookie.value)).toBe(true);
      expect(cookie).toMatchObject({
        path: '/',
        httpOnly: false,
        sameSite: 'Lax',
        // Secure only under NODE_ENV=production; csrf.spec covers that.
        secure: false,
        maxAge: THIRTY_DAYS_S,
      });
      expect(res.body).toEqual({ csrfToken: cookie.value });
      expect(res.get('Cache-Control')).toBe('no-store');
    });

    it('hands back the token the browser already holds, without setting a new one', async () => {
      const held = newCsrfToken();

      const res = await ctx()
        .httpWithoutCsrf()
        .get(`${AUTH}/csrf`)
        .set('Cookie', `${CSRF_COOKIE}=${held}`)
        .expect(200);

      expect(res.body).toEqual({ csrfToken: held });
      expect(parseSetCookies(res).has(CSRF_COOKIE)).toBe(false);
    });

    it('replaces a cookie that is not one of ours', async () => {
      const res = await ctx()
        .httpWithoutCsrf()
        .get(`${AUTH}/csrf`)
        .set('Cookie', `${CSRF_COOKIE}=not-a-token`)
        .expect(200);

      const cookie = getSetCookie(res, CSRF_COOKIE);
      expect(isCsrfToken(cookie.value)).toBe(true);
      expect(res.body).toEqual({ csrfToken: cookie.value });
    });

    it('gives a first-time visitor what the contact form needs to send', async () => {
      const t = ctx();
      const issued = await t.httpWithoutCsrf().get(`${AUTH}/csrf`).expect(200);
      const { csrfToken } = issued.body as { csrfToken: string };

      await t
        .httpWithoutCsrf()
        .post(CONTACT)
        .set(withPair(csrfToken, csrfToken))
        .send(enquiry)
        .expect(202);
    });
  });

  describe('a new token when who is signed in changes', () => {
    it('on sign-in', async () => {
      const t = ctx();
      await register(t);

      const res = await t
        .http()
        .post(`${AUTH}/login`)
        .send({ email: 'ada@example.com', password: PASSWORD })
        .expect(200);

      const issued = getSetCookie(res, CSRF_COOKIE);
      expect(isCsrfToken(issued.value)).toBe(true);
      expect(issued.value).not.toBe(t.csrfToken);
      expect(issued.path).toBe('/');
    });

    it('on creating an account', async () => {
      const t = ctx();
      const { res } = await register(t);

      expect(getSetCookie(res, CSRF_COOKIE).value).not.toBe(t.csrfToken);
    });

    it('on sign-out', async () => {
      const t = ctx();

      const res = await t.http().post(`${AUTH}/logout`).expect(204);

      expect(getSetCookie(res, CSRF_COOKIE).value).not.toBe(t.csrfToken);
    });

    it('but not on refresh, which other tabs run all the time', async () => {
      const t = ctx();
      const { refreshToken } = await register(t);

      const res = await t
        .http()
        .post(`${AUTH}/refresh`)
        .set('Cookie', `${REFRESH_COOKIE}=${refreshToken}`)
        .expect(200);

      expect(parseSetCookies(res).has(CSRF_COOKIE)).toBe(false);
    });

    it('and not on a failed sign-in', async () => {
      const res = await ctx()
        .http()
        .post(`${AUTH}/login`)
        .send({ email: 'nobody@example.com', password: 'not-the-password' })
        .expect(401);

      expect(parseSetCookies(res).has(CSRF_COOKIE)).toBe(false);
    });
  });
});
