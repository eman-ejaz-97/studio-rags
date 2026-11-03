import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import type { AccessTokenClaims } from '../token.service';
import { JwtStrategy } from './jwt.strategy';

const ACCESS_SECRET = 'unit-test-only-access-secret-not-for-real-use';
const REFRESH_SECRET = 'unit-test-only-refresh-secret-not-for-real-use';

/** A stub rather than a real ConfigService, which would prefer process.env. */
function configStub(values: Record<string, string>): ConfigService {
  return {
    getOrThrow: (key: string) => {
      if (!(key in values)) {
        throw new TypeError(`Configuration key "${key}" does not exist`);
      }
      return values[key];
    },
  } as unknown as ConfigService;
}

type Outcome =
  | { kind: 'success'; user: AuthenticatedUser }
  | { kind: 'fail'; reason: unknown }
  | { kind: 'error'; error: unknown };

interface PassportDelegate {
  success(user: unknown): void;
  fail(reason?: unknown): void;
  error(error: unknown): void;
  authenticate(req: unknown, options: object): void;
}

/**
 * Runs the strategy the way passport does: a per-request object that inherits
 * from the strategy, with success/fail/error attached. Exercises the real
 * extractors, signature check and validate() without needing a server.
 */
function authenticate(strategy: JwtStrategy, req: object): Promise<Outcome> {
  return new Promise((resolve) => {
    const delegate = Object.create(strategy) as PassportDelegate;
    delegate.success = (user) =>
      resolve({ kind: 'success', user: user as AuthenticatedUser });
    delegate.fail = (reason) => resolve({ kind: 'fail', reason });
    delegate.error = (error) => resolve({ kind: 'error', error });
    delegate.authenticate(req, {});
  });
}

describe('JwtStrategy', () => {
  const jwt = new JwtService({});
  const strategy = new JwtStrategy(
    configStub({ JWT_ACCESS_SECRET: ACCESS_SECRET }),
  );

  const accessToken = (sub: string, secret = ACCESS_SECRET) =>
    jwt.signAsync(
      { sub, email: `${sub}@example.com`, role: Role.CUSTOMER, typ: 'access' },
      { secret, expiresIn: 900 },
    );

  it('refuses to start without JWT_ACCESS_SECRET', () => {
    expect(() => new JwtStrategy(configStub({}))).toThrow('JWT_ACCESS_SECRET');
  });

  describe('token extraction', () => {
    it('accepts the token from the sr_access cookie', async () => {
      const token = await accessToken('cookie_user');

      const outcome = await authenticate(strategy, {
        headers: {},
        cookies: { sr_access: token },
      });

      expect(outcome).toEqual({
        kind: 'success',
        user: {
          id: 'cookie_user',
          email: 'cookie_user@example.com',
          role: Role.CUSTOMER,
        },
      });
    });

    it('falls back to an Authorization: Bearer header', async () => {
      const token = await accessToken('header_user');

      const outcome = await authenticate(strategy, {
        headers: { authorization: `Bearer ${token}` },
      });

      expect(outcome).toMatchObject({
        kind: 'success',
        user: { id: 'header_user' },
      });
    });

    it('prefers the cookie when both are present', async () => {
      const outcome = await authenticate(strategy, {
        headers: {
          authorization: `Bearer ${await accessToken('header_user')}`,
        },
        cookies: { sr_access: await accessToken('cookie_user') },
      });

      expect(outcome).toMatchObject({
        kind: 'success',
        user: { id: 'cookie_user' },
      });
    });

    it('fails when neither carries a token', async () => {
      const outcome = await authenticate(strategy, {
        headers: {},
        cookies: {},
      });

      expect(outcome.kind).toBe('fail');
    });

    it('copes with a request that has no cookies object at all', async () => {
      // cookie-parser may not have run (or the client sent no Cookie header).
      const outcome = await authenticate(strategy, {
        headers: {
          authorization: `Bearer ${await accessToken('header_user')}`,
        },
      });

      expect(outcome.kind).toBe('success');
    });
  });

  describe('token checks', () => {
    it('rejects a refresh token, which is signed with the other secret', async () => {
      const refreshLike = await jwt.signAsync(
        { sub: 'user_1', jti: 'a'.repeat(48) },
        { secret: REFRESH_SECRET, expiresIn: 3600 },
      );

      const outcome = await authenticate(strategy, {
        headers: {},
        cookies: { sr_access: refreshLike },
      });

      expect(outcome).toMatchObject({
        kind: 'fail',
        reason: { message: 'invalid signature' },
      });
    });

    it('rejects an expired access token', async () => {
      const expired = await jwt.signAsync(
        {
          sub: 'user_1',
          email: 'user_1@example.com',
          role: Role.CUSTOMER,
          typ: 'access',
          exp: Math.floor(Date.now() / 1000) - 60,
        },
        { secret: ACCESS_SECRET },
      );

      const outcome = await authenticate(strategy, {
        headers: {},
        cookies: { sr_access: expired },
      });

      expect(outcome).toMatchObject({
        kind: 'fail',
        reason: { name: 'TokenExpiredError' },
      });
    });

    it.each([
      ['refresh', { sub: 'user_1', jti: 'a'.repeat(48), typ: 'refresh' }],
      [
        'none (issued before the claim existed)',
        { sub: 'user_1', email: 'x@example.com', role: Role.ADMIN },
      ],
    ])(
      'turns a token whose typ is %s into a 401, even signed with the access key',
      async (_label, claims) => {
        // The access key signing a refresh token is the shared-secret mistake
        // validateEnv refuses at boot; this is the check behind that one.
        const token = await jwt.signAsync(claims, {
          secret: ACCESS_SECRET,
          expiresIn: 3600,
        });

        const outcome = await authenticate(strategy, {
          headers: { authorization: `Bearer ${token}` },
        });

        expect(outcome).toMatchObject({
          kind: 'error',
          error: expect.any(UnauthorizedException) as UnauthorizedException,
        });
      },
    );

    it('turns a correctly signed token with no subject into a 401', async () => {
      const subjectless = await jwt.signAsync(
        { email: 'x@example.com', role: Role.ADMIN, typ: 'access' },
        { secret: ACCESS_SECRET, expiresIn: 900 },
      );

      const outcome = await authenticate(strategy, {
        headers: {},
        cookies: { sr_access: subjectless },
      });

      expect(outcome.kind).toBe('error');
      expect(outcome).toMatchObject({
        error: expect.any(UnauthorizedException) as UnauthorizedException,
      });
    });
  });

  describe('validate', () => {
    it('maps the claims onto the request user and nothing else', () => {
      const payload = {
        sub: 'user_1',
        email: 'jane@example.com',
        role: Role.ADMIN,
        typ: 'access' as const,
        iat: 1,
        exp: 2,
      };

      expect(strategy.validate(payload)).toEqual({
        id: 'user_1',
        email: 'jane@example.com',
        role: Role.ADMIN,
      });
    });

    it.each([
      [
        'an empty subject',
        { sub: '', email: 'x@example.com', role: Role.ADMIN, typ: 'access' },
      ],
      [
        'no subject',
        { email: 'x@example.com', role: Role.ADMIN, typ: 'access' },
      ],
      ['no payload', undefined],
      [
        'typ refresh',
        {
          sub: 'user_1',
          email: 'x@example.com',
          role: Role.ADMIN,
          typ: 'refresh',
        },
      ],
      ['no typ', { sub: 'user_1', email: 'x@example.com', role: Role.ADMIN }],
      [
        'a typ in the wrong case',
        {
          sub: 'user_1',
          email: 'x@example.com',
          role: Role.ADMIN,
          typ: 'Access',
        },
      ],
    ])('rejects %s', (_label, payload) => {
      expect(() =>
        strategy.validate(payload as unknown as AccessTokenClaims),
      ).toThrow(UnauthorizedException);
    });
  });
});
