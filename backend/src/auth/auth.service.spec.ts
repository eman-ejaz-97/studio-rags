import {
  ConflictException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  PasswordResetToken,
  Prisma,
  RefreshToken,
  RefreshTokenRevocation,
  Role,
  User,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  AuthService,
  DUMMY_HASH,
  REFRESH_REUSE_GRACE_MS,
  RefreshRaceLostException,
} from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { TokenService } from './token.service';

// Call-through spies: the real argon2 still runs, so hashes are genuine, but
// the tests can see what was verified and force a failure where needed.
jest.mock('argon2', () => {
  const actual = jest.requireActual<typeof import('argon2')>('argon2');
  return {
    ...actual,
    hash: jest.fn(actual.hash),
    verify: jest.fn(actual.verify),
  };
});

const realArgon2 = jest.requireActual<typeof import('argon2')>('argon2');

const ACCESS_SECRET = 'unit-test-only-access-secret-not-for-real-use';
const REFRESH_SECRET = 'unit-test-only-refresh-secret-not-for-real-use';
const APP_URL = 'http://localhost:3000';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'development',
  JWT_ACCESS_SECRET: ACCESS_SECRET,
  JWT_REFRESH_SECRET: REFRESH_SECRET,
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
  APP_URL,
};

/** Independent of TokenService.hash, so a broken hash() cannot agree with itself. */
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/**
 * A plain stub rather than a real ConfigService: the real one reads
 * process.env first, and Jest sets NODE_ENV=test, which would mask the
 * production branch of requestPasswordReset.
 */
function configStub(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!(key in values)) {
        throw new TypeError(`Configuration key "${key}" does not exist`);
      }
      return values[key];
    },
  } as unknown as ConfigService;
}

type StoredRefreshToken = Pick<RefreshToken, 'id' | 'userId'>;
type SuccessorState = Pick<RefreshToken, 'id' | 'revokedReason'>;
/** What the read under the lock sees of a row its claim could not spend. */
type RevocationState = Pick<RefreshToken, 'revokedAt' | 'revokedReason'> & {
  rotatedTo?: SuccessorState | null;
};

/**
 * The client an interactive $transaction hands its callback. Kept separate
 * from the root mock, so a test can tell a write made inside the transaction
 * from one made outside it, which would not roll back with the rest.
 *
 * By default the user exists, so the lock query returns their row, and the
 * user read under the lock returns makeUser().
 */
function createTransactionMock() {
  return {
    // Only ever the per-user lock (SELECT ... FOR UPDATE).
    $queryRaw: jest.fn<
      Promise<unknown[]>,
      [TemplateStringsArray, ...unknown[]]
    >(() => Promise.resolve([{ id: 'user_1' }])),
    user: {
      findUnique: jest.fn<Promise<User | null>, [Prisma.UserFindUniqueArgs]>(
        () => Promise.resolve(makeUser()),
      ),
      update: jest.fn<Promise<unknown>, [Prisma.UserUpdateArgs]>(),
    },
    passwordResetToken: {
      updateMany: jest.fn<
        Promise<Prisma.BatchPayload>,
        [Prisma.PasswordResetTokenUpdateManyArgs]
      >(),
    },
    refreshToken: {
      create: jest.fn<Promise<unknown>, [Prisma.RefreshTokenCreateArgs]>(),
      findUnique: jest.fn<
        Promise<RevocationState | null>,
        [Prisma.RefreshTokenFindUniqueArgs]
      >(),
      updateMany: jest.fn<
        Promise<Prisma.BatchPayload>,
        [Prisma.RefreshTokenUpdateManyArgs]
      >(),
    },
  };
}

type TransactionMock = ReturnType<typeof createTransactionMock>;

function createPrismaMock() {
  const tx = createTransactionMock();
  return {
    tx,
    user: {
      create: jest.fn<Promise<User>, [Prisma.UserCreateArgs]>(),
      findUnique: jest.fn<Promise<User | null>, [Prisma.UserFindUniqueArgs]>(),
      update: jest.fn<unknown, [Prisma.UserUpdateArgs]>(),
    },
    refreshToken: {
      create: jest.fn<Promise<unknown>, [Prisma.RefreshTokenCreateArgs]>(),
      findUnique: jest.fn<
        Promise<StoredRefreshToken | null>,
        [Prisma.RefreshTokenFindUniqueArgs]
      >(),
      update: jest.fn<Promise<unknown>, [Prisma.RefreshTokenUpdateArgs]>(),
      updateMany: jest.fn<
        Promise<Prisma.BatchPayload>,
        [Prisma.RefreshTokenUpdateManyArgs]
      >(),
    },
    passwordResetToken: {
      create: jest.fn<
        Promise<unknown>,
        [Prisma.PasswordResetTokenCreateArgs]
      >(),
      findUnique: jest.fn<
        Promise<PasswordResetToken | null>,
        [Prisma.PasswordResetTokenFindUniqueArgs]
      >(),
      update: jest.fn<unknown, [Prisma.PasswordResetTokenUpdateArgs]>(),
    },
    // Runs the callback against the transaction client, and lets whatever it
    // throws escape, as Prisma does after rolling back.
    $transaction: jest.fn(
      (callback: (client: TransactionMock) => Promise<unknown>) => callback(tx),
    ),
  };
}

function setup(env: Record<string, string | undefined> = {}) {
  const prisma = createPrismaMock();
  const config = configStub({ ...BASE_ENV, ...env });
  const jwt = new JwtService({});
  const tokens = new TokenService(jwt, config);
  const service = new AuthService(
    prisma as unknown as PrismaService,
    tokens,
    config,
  );
  return { prisma, jwt, tokens, service };
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user_1',
    email: 'jane@example.com',
    passwordHash: DUMMY_HASH,
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    role: Role.CUSTOMER,
    emailVerifiedAt: null,
    marketingConsentAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/** What rotateSession's first read sees: just enough to find the lock. */
function storedRefreshToken(
  overrides: Partial<StoredRefreshToken> = {},
): StoredRefreshToken {
  return { id: 'rt_1', userId: 'user_1', ...overrides };
}

/** The lock query's SQL and bound values, from a $queryRaw mock call. */
function lockQuery(tx: TransactionMock, call = 0) {
  const [strings, ...values] = tx.$queryRaw.mock.calls[call];
  return { sql: strings.join('$'), values };
}

/** When a mock was first called, to compare the order of two calls. */
const order = (mock: jest.Mock) => mock.mock.invocationCallOrder[0];

/** Awaits a promise that must reject and hands back what it rejected with. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject, but it resolved');
}

/** Silences one Logger level for the test and lets it be inspected. */
function spyOnLogger(level: 'log' | 'warn' | 'error' | 'debug' | 'verbose') {
  return jest.spyOn(Logger.prototype, level).mockImplementation(() => {});
}

/**
 * Stops the clock at `now` for new Date() and Date.now(), and nothing else:
 * timers, ticks and microtasks stay real, so the async JWT and argon2 calls
 * still complete. Lets a test sit exactly on the grace-window boundary.
 */
function freezeClockAt(now: number) {
  jest.useFakeTimers({
    now,
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('toPublicUser', () => {
    it('exposes the profile and consent as a boolean, never the password hash', () => {
      const { service } = setup();
      const consentAt = new Date('2026-02-01T00:00:00.000Z');
      const user = makeUser({ marketingConsentAt: consentAt, phone: '0400' });

      expect(service.toPublicUser(user)).toEqual({
        id: 'user_1',
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: '0400',
        role: Role.CUSTOMER,
        marketingConsent: true,
        createdAt: user.createdAt,
      });
      expect(
        service.toPublicUser(makeUser({ marketingConsentAt: null })),
      ).toMatchObject({ marketingConsent: false });
    });
  });

  describe('register', () => {
    const dto: RegisterDto = {
      email: 'jane@example.com',
      password: 'correct horse battery',
      firstName: 'Jane',
      lastName: 'Doe',
    };

    it('stores an argon2id hash of the password, never the password itself', async () => {
      const { prisma, service } = setup();
      prisma.user.create.mockResolvedValue(makeUser());

      await service.register(dto);

      const { data } = prisma.user.create.mock.calls[0][0];
      expect(data.passwordHash).toMatch(/^\$argon2id\$/);
      expect(data.passwordHash).not.toContain(dto.password);
      await expect(
        realArgon2.verify(data.passwordHash, dto.password),
      ).resolves.toBe(true);
      expect(data).toMatchObject({
        email: 'jane@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        phone: null,
      });
    });

    it('returns the created user', async () => {
      const { prisma, service } = setup();
      const created = makeUser({ id: 'user_new' });
      prisma.user.create.mockResolvedValue(created);

      await expect(service.register(dto)).resolves.toBe(created);
    });

    it('keeps the phone number when one is given', async () => {
      const { prisma, service } = setup();
      prisma.user.create.mockResolvedValue(makeUser());

      await service.register({ ...dto, phone: '0400 000 000' });

      expect(prisma.user.create.mock.calls[0][0].data.phone).toBe(
        '0400 000 000',
      );
    });

    it('records when consent was given if marketingConsent is true', async () => {
      const { prisma, service } = setup();
      prisma.user.create.mockResolvedValue(makeUser());
      const before = Date.now();

      await service.register({ ...dto, marketingConsent: true });

      const consentAt = prisma.user.create.mock.calls[0][0].data
        .marketingConsentAt as Date;
      expect(consentAt).toBeInstanceOf(Date);
      expect(consentAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(consentAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it.each([false, undefined])(
      'leaves marketingConsentAt null when marketingConsent is %p (FR-M2 opt-in)',
      async (marketingConsent) => {
        const { prisma, service } = setup();
        prisma.user.create.mockResolvedValue(makeUser());

        await service.register({ ...dto, marketingConsent });

        expect(
          prisma.user.create.mock.calls[0][0].data.marketingConsentAt,
        ).toBeNull();
      },
    );

    it('turns a unique-email clash (P2002) into a 409 Conflict', async () => {
      const { prisma, service } = setup();
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError(
          'Unique constraint failed on the fields: (`email`)',
          { code: 'P2002', clientVersion: 'test' },
        ),
      );

      const error = await rejectionOf(service.register(dto));

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).message).toBe(
        'An account with that email already exists',
      );
    });

    it('rethrows any other Prisma error untouched', async () => {
      const { prisma, service } = setup();
      const foreignKey = new Prisma.PrismaClientKnownRequestError(
        'Foreign key constraint failed',
        { code: 'P2003', clientVersion: 'test' },
      );
      prisma.user.create.mockRejectedValue(foreignKey);

      await expect(rejectionOf(service.register(dto))).resolves.toBe(
        foreignKey,
      );
    });

    it('rethrows a non-Prisma error untouched', async () => {
      const { prisma, service } = setup();
      const outage = new Error('connection reset');
      prisma.user.create.mockRejectedValue(outage);

      await expect(rejectionOf(service.register(dto))).resolves.toBe(outage);
    });
  });

  describe('validateCredentials', () => {
    const password = 'correct horse battery';
    let realHash: string;

    beforeAll(async () => {
      realHash = await realArgon2.hash(password, { type: realArgon2.argon2id });
    });

    it('returns the user when the password matches', async () => {
      const { prisma, service } = setup();
      const user = makeUser({ passwordHash: realHash });
      prisma.user.findUnique.mockResolvedValue(user);

      await expect(
        service.validateCredentials('jane@example.com', password),
      ).resolves.toBe(user);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'jane@example.com' },
      });
    });

    it('rejects a wrong password with 401', async () => {
      const { prisma, service } = setup();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash: realHash }),
      );

      const error = await rejectionOf(
        service.validateCredentials('jane@example.com', 'wrong password'),
      );

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(
        'Email or password is incorrect',
      );
    });

    it('answers an unknown email exactly as it answers a wrong password', async () => {
      const { prisma, service } = setup();
      prisma.user.findUnique.mockResolvedValueOnce(
        makeUser({ passwordHash: realHash }),
      );
      const wrongPassword = (await rejectionOf(
        service.validateCredentials('jane@example.com', 'wrong password'),
      )) as UnauthorizedException;

      prisma.user.findUnique.mockResolvedValueOnce(null);
      const unknownEmail = (await rejectionOf(
        service.validateCredentials('nobody@example.com', 'wrong password'),
      )) as UnauthorizedException;

      expect(unknownEmail).toBeInstanceOf(UnauthorizedException);
      // Same class, same message, same body: nothing for an attacker to diff.
      expect(unknownEmail.message).toBe(wrongPassword.message);
      expect(unknownEmail.getResponse()).toEqual(wrongPassword.getResponse());
    });

    it('still runs argon2.verify for an unknown email, against the dummy hash', async () => {
      const { prisma, service } = setup();
      prisma.user.findUnique.mockResolvedValue(null);

      await rejectionOf(
        service.validateCredentials('nobody@example.com', 'guess-1234'),
      );

      // Skipping the verify would make "no such account" answer measurably
      // faster than "wrong password", leaking which emails are registered.
      expect(argon2.verify).toHaveBeenCalledTimes(1);
      expect(argon2.verify).toHaveBeenCalledWith(DUMMY_HASH, 'guess-1234');
    });

    it('treats a stored hash argon2 cannot parse as a failed login, not a 500', async () => {
      const { prisma, service } = setup();
      prisma.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash: 'not-a-phc-string' }),
      );

      const error = await rejectionOf(
        service.validateCredentials('jane@example.com', password),
      );

      expect(argon2.verify).toHaveBeenCalledWith('not-a-phc-string', password);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(
        'Email or password is incorrect',
      );
    });
  });

  // Run against the real argon2 with nothing mocked: if DUMMY_HASH were
  // malformed, verify would throw straight away and the timing defence would
  // be gone; if its cost were lower than a real hash, it would be weaker.
  describe('DUMMY_HASH', () => {
    function costOf(phc: string) {
      const [, algorithm, version, params] = phc.split('$');
      return {
        algorithm,
        version,
        // Compared as a map because argon2 0.45 writes m,p,t while DUMMY_HASH
        // lists m,t,p. The order has no effect on the work done.
        params: Object.fromEntries(
          params.split(',').map((pair) => pair.split('=')),
        ) as Record<string, string>,
      };
    }

    it('verifies to false without throwing', async () => {
      await expect(realArgon2.verify(DUMMY_HASH, 'anything')).resolves.toBe(
        false,
      );
    });

    it('costs the same as a hash argon2 produces today', async () => {
      const fresh = await realArgon2.hash('x', { type: realArgon2.argon2id });

      expect(costOf(DUMMY_HASH)).toEqual(costOf(fresh));
      expect(costOf(DUMMY_HASH)).toEqual({
        algorithm: 'argon2id',
        version: 'v=19',
        params: { m: '65536', t: '3', p: '4' },
      });
    });
  });

  describe('issueSession', () => {
    it('returns an access token and a refresh token for the user', async () => {
      const { prisma, jwt, tokens, service } = setup();
      const user = makeUser({ role: Role.ADMIN });
      prisma.tx.user.findUnique.mockResolvedValue(user);

      const session = await service.issueSession(user);

      await expect(
        jwt.verifyAsync(session.accessToken, { secret: ACCESS_SECRET }),
      ).resolves.toMatchObject({
        sub: 'user_1',
        email: 'jane@example.com',
        role: Role.ADMIN,
      });
      await expect(
        tokens.verifyRefreshToken(session.refreshToken),
      ).resolves.toMatchObject({ sub: 'user_1' });
    });

    it('stores only the SHA-256 of the refresh token, never the token', async () => {
      const { prisma, service } = setup();

      const { refreshToken } = await service.issueSession(makeUser());

      const { data } = prisma.tx.refreshToken.create.mock.calls[0][0];
      expect(data.tokenHash).toBe(sha256(refreshToken));
      expect(data.userId).toBe('user_1');
      expect(JSON.stringify(data)).not.toContain(refreshToken);
    });

    it('expires the stored row one refresh TTL from now', async () => {
      const { prisma, service } = setup();
      const before = Date.now();

      await service.issueSession(makeUser());

      const after = Date.now();
      const expiresAt = prisma.tx.refreshToken.create.mock.calls[0][0].data
        .expiresAt as Date;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + REFRESH_TTL_MS,
      );
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after + REFRESH_TTL_MS);
    });

    it('truncates the user agent to the 255 characters the column holds', async () => {
      const { prisma, service } = setup();

      await service.issueSession(makeUser(), {
        userAgent: 'a'.repeat(300),
        ip: '203.0.113.7',
      });

      const { data } = prisma.tx.refreshToken.create.mock.calls[0][0];
      expect(data.userAgent).toBe('a'.repeat(255));
      expect(data.ip).toBe('203.0.113.7');
    });

    it('stores null rather than undefined when there is no request context', async () => {
      const { prisma, service } = setup();

      await service.issueSession(makeUser());

      const { data } = prisma.tx.refreshToken.create.mock.calls[0][0];
      expect(data.userAgent).toBeNull();
      expect(data.ip).toBeNull();
    });

    it('links the session to no earlier token: a sign-in starts a new chain', async () => {
      const { prisma, service } = setup();

      await service.issueSession(makeUser());

      const { data } = prisma.tx.refreshToken.create.mock.calls[0][0];
      expect(data.rotatedFromId).toBeNull();
    });

    it("writes the session inside a transaction, after taking the user's row lock", async () => {
      const { prisma, service } = setup();
      const { tx } = prisma;

      await service.issueSession(makeUser());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(lockQuery(tx)).toEqual({
        sql: expect.stringMatching(
          /FROM "users" WHERE "id" = \$ FOR UPDATE/,
        ) as string,
        values: ['user_1'],
      });
      // Lock, then read the hash under it, then write: a reset that commits
      // in between is either seen by the read or waits for this write.
      expect(order(tx.$queryRaw)).toBeLessThan(order(tx.user.findUnique));
      expect(order(tx.user.findUnique)).toBeLessThan(
        order(tx.refreshToken.create),
      );
    });

    it('refuses, and writes nothing, when the password changed after it was checked', async () => {
      // A reset committed between the argon2 verify and this write. A
      // session opened with the old password must not outlive the reset.
      const { prisma, service } = setup();
      prisma.tx.user.findUnique.mockResolvedValue(
        makeUser({ passwordHash: '$argon2id$the-new-password-hash' }),
      );

      const error = await rejectionOf(service.issueSession(makeUser()));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(
        'Email or password is incorrect',
      );
      expect(prisma.tx.refreshToken.create).not.toHaveBeenCalled();
    });

    it('refuses, and writes nothing, when the account no longer exists', async () => {
      const { prisma, service } = setup();
      prisma.tx.$queryRaw.mockResolvedValue([]);

      const error = await rejectionOf(service.issueSession(makeUser()));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(prisma.tx.refreshToken.create).not.toHaveBeenCalled();
    });
  });

  describe('rotateSession', () => {
    const EXPIRED = 'Session expired, please sign in again';

    /**
     * A signed refresh token whose row exists, and whose claim the database
     * refuses: the row is no longer live, for the reason given.
     */
    async function spentToken(revocation: RevocationState) {
      const ctx = setup();
      const { token } = await ctx.tokens.signRefreshToken('user_1');
      ctx.prisma.refreshToken.findUnique.mockResolvedValue(
        storedRefreshToken(),
      );
      ctx.prisma.tx.refreshToken.updateMany.mockResolvedValueOnce({
        count: 0,
      });
      ctx.prisma.tx.refreshToken.findUnique.mockResolvedValue(revocation);
      return { ...ctx, token };
    }

    const rotatedAgo = (ms: number, now = Date.now()): RevocationState => ({
      revokedAt: new Date(now - ms),
      revokedReason: RefreshTokenRevocation.ROTATED,
    });

    it('rejects a missing token without touching the database', async () => {
      const { prisma, service } = setup();

      const error = await rejectionOf(service.rotateSession(undefined));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe('Not signed in');
      expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a token that is not a valid JWT before any lookup', async () => {
      const { prisma, service } = setup();

      const error = await rejectionOf(service.rotateSession('not-a-jwt'));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(EXPIRED);
      expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects an access token presented as a refresh token', async () => {
      const { prisma, tokens, service } = setup();
      const accessToken = await tokens.signAccessToken({
        sub: 'user_1',
        email: 'jane@example.com',
        role: Role.CUSTOMER,
      });

      const error = await rejectionOf(service.rotateSession(accessToken));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
    });

    it('rejects a well-signed token with no stored row, without opening a transaction', async () => {
      const { prisma, tokens, service } = setup();
      const { token } = await tokens.signRefreshToken('user_1');
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      const error = await rejectionOf(service.rotateSession(token));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error).not.toBeInstanceOf(RefreshRaceLostException);
      expect((error as UnauthorizedException).message).toBe(EXPIRED);
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: sha256(token) },
        select: { id: true, userId: true },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('refuses an access token even when it is signed with the refresh key', async () => {
      // The configuration validateEnv now forbids: both secrets the same.
      const { prisma, service } = setup({ JWT_REFRESH_SECRET: ACCESS_SECRET });
      const accessToken = await new JwtService({}).signAsync(
        {
          sub: 'user_1',
          email: 'jane@example.com',
          role: Role.ADMIN,
          typ: 'access',
        },
        { secret: ACCESS_SECRET, expiresIn: 900 },
      );

      const error = await rejectionOf(service.rotateSession(accessToken));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(EXPIRED);
      expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
    });

    it('spends the presented row with a conditional update, then issues a fresh session', async () => {
      const { prisma, tokens, service } = setup();
      const { tx } = prisma;
      const { token } = await tokens.signRefreshToken('user_1');
      prisma.refreshToken.findUnique.mockResolvedValue(
        storedRefreshToken({ id: 'rt_presented' }),
      );
      tx.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const session = await service.rotateSession(token, {
        userAgent: 'Mozilla/5.0',
        ip: '203.0.113.7',
      });

      // The WHERE repeats the liveness checks, so the database, not the
      // earlier read, decides whether this request may spend the token. The
      // reason marks it as rotated, the only kind whose reuse means theft.
      expect(tx.refreshToken.updateMany).toHaveBeenCalledTimes(1);
      const claim = tx.refreshToken.updateMany.mock.calls[0][0];
      expect(claim).toEqual({
        where: {
          id: 'rt_presented',
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) as Date },
        },
        data: {
          revokedAt: expect.any(Date) as Date,
          revokedReason: RefreshTokenRevocation.ROTATED,
        },
      });
      const where = claim.where as { expiresAt: { gt: Date } };
      expect(where.expiresAt.gt).toBe(claim.data.revokedAt);
      // A plain update by id is the old read-then-write race.
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();

      expect(session.refreshToken).not.toBe(token);
      await expect(
        tokens.verifyRefreshToken(session.refreshToken),
      ).resolves.toMatchObject({ sub: 'user_1' });

      const { data } = tx.refreshToken.create.mock.calls[0][0];
      expect(data.tokenHash).toBe(sha256(session.refreshToken));
      expect(data.tokenHash).not.toBe(sha256(token));
      expect(data.userAgent).toBe('Mozilla/5.0');
      expect(data.ip).toBe('203.0.113.7');
      // Linked to the token it replaced, so reuse detection can later see
      // whether this successor was ever used.
      expect(data.rotatedFromId).toBe('rt_presented');
    });

    it('takes the lock, spends the old token and writes the new one in a single transaction', async () => {
      // Split across transactions, a password reset could commit between the
      // spend and the write and miss the new session: that session would
      // then outlive the reset that was meant to end it.
      const { prisma, tokens, service } = setup();
      const { tx } = prisma;
      const { token } = await tokens.signRefreshToken('user_1');
      prisma.refreshToken.findUnique.mockResolvedValue(storedRefreshToken());
      tx.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.rotateSession(token);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(lockQuery(tx).values).toEqual(['user_1']);
      expect(order(tx.$queryRaw)).toBeLessThan(
        order(tx.refreshToken.updateMany),
      );
      expect(order(tx.refreshToken.updateMany)).toBeLessThan(
        order(tx.refreshToken.create),
      );
    });

    it("locks the user the stored row belongs to, not the token's own claim", async () => {
      const { prisma, tokens, service } = setup();
      const { token } = await tokens.signRefreshToken('user_1');
      prisma.refreshToken.findUnique.mockResolvedValue(
        storedRefreshToken({ userId: 'user_from_row' }),
      );
      prisma.tx.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.rotateSession(token);

      expect(lockQuery(prisma.tx).values).toEqual(['user_from_row']);
      expect(prisma.tx.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user_from_row' },
      });
    });

    it('signs the new access token from the user as read under the lock', async () => {
      // The role may have changed since the token was issued; the session
      // must carry what is true now.
      const { prisma, jwt, tokens, service } = setup();
      const { token } = await tokens.signRefreshToken('user_1');
      prisma.refreshToken.findUnique.mockResolvedValue(storedRefreshToken());
      prisma.tx.user.findUnique.mockResolvedValue(
        makeUser({ role: Role.ADMIN, email: 'jane.new@example.com' }),
      );
      prisma.tx.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const session = await service.rotateSession(token);

      await expect(
        jwt.verifyAsync(session.accessToken, { secret: ACCESS_SECRET }),
      ).resolves.toMatchObject({
        role: Role.ADMIN,
        email: 'jane.new@example.com',
      });
    });

    it('rejects, and writes nothing, when the account has gone', async () => {
      const { prisma, tokens, service } = setup();
      const { token } = await tokens.signRefreshToken('user_1');
      prisma.refreshToken.findUnique.mockResolvedValue(storedRefreshToken());
      prisma.tx.$queryRaw.mockResolvedValue([]);

      const error = await rejectionOf(service.rotateSession(token));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error).not.toBeInstanceOf(RefreshRaceLostException);
      expect(prisma.tx.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.tx.refreshToken.create).not.toHaveBeenCalled();
    });

    it('rejects an expired row as a dead token: no global revoke, cookies cleared', async () => {
      const { prisma, token, service } = await spentToken({
        revokedAt: null,
        revokedReason: null,
      });

      const error = await rejectionOf(service.rotateSession(token));

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error).not.toBeInstanceOf(RefreshRaceLostException);
      expect((error as UnauthorizedException).message).toBe(EXPIRED);
      // Only the failed claim itself.
      expect(prisma.tx.refreshToken.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.tx.refreshToken.create).not.toHaveBeenCalled();
    });

    it('allows ten seconds for a spent token to come back before calling it theft', () => {
      expect(REFRESH_REUSE_GRACE_MS).toBe(10_000);
    });

    describe('a token rotated within the grace window (two tabs, one cookie)', () => {
      it('gets a race-lost 401 and revokes nothing', async () => {
        const warn = spyOnLogger('warn');
        const { prisma, token, service } = await spentToken(
          rotatedAgo(REFRESH_REUSE_GRACE_MS - 1000),
        );

        const error = await rejectionOf(service.rotateSession(token));

        // Its own class, so the controller leaves the shared cookie jar alone.
        expect(error).toBeInstanceOf(RefreshRaceLostException);
        expect(error).toBeInstanceOf(UnauthorizedException);
        expect((error as UnauthorizedException).message).toBe(EXPIRED);
        expect((error as UnauthorizedException).getStatus()).toBe(401);
        // No global revoke, so the tab that won keeps its new session.
        expect(prisma.tx.refreshToken.updateMany).toHaveBeenCalledTimes(1);
        expect(warn).not.toHaveBeenCalled();
      });

      it('is what a request gets when it loses the claim outright', async () => {
        // The other request spent the token a moment before this one's claim.
        const { token, service } = await spentToken(rotatedAgo(0));

        await expect(
          rejectionOf(service.rotateSession(token)),
        ).resolves.toBeInstanceOf(RefreshRaceLostException);
      });

      it('never issues a session', async () => {
        const { prisma, tokens, token, service } = await spentToken(
          rotatedAgo(0),
        );
        const sign = jest.spyOn(tokens, 'signAccessToken');

        await rejectionOf(service.rotateSession(token));

        expect(sign).not.toHaveBeenCalled();
        expect(prisma.tx.refreshToken.create).not.toHaveBeenCalled();
      });

      it('still applies 1 ms before the window closes', async () => {
        const now = Date.UTC(2026, 10, 3, 9, 0, 0);
        freezeClockAt(now);
        const { prisma, token, service } = await spentToken(
          rotatedAgo(REFRESH_REUSE_GRACE_MS - 1, now),
        );

        await expect(
          rejectionOf(service.rotateSession(token)),
        ).resolves.toBeInstanceOf(RefreshRaceLostException);
        expect(prisma.tx.refreshToken.updateMany).toHaveBeenCalledTimes(1);
      });
    });

    /** The successor the refresh that spent the presented token wrote. */
    const successor = (
      revokedReason: RefreshTokenRevocation | null,
    ): SuccessorState => ({ id: 'rt_next', revokedReason });

    /** The every-session revoke a theft response makes. */
    const SWEEP = {
      where: { userId: 'user_1', revokedAt: null },
      data: {
        revokedAt: expect.any(Date) as Date,
        revokedReason: RefreshTokenRevocation.REUSE_DETECTED,
      },
    };

    describe('a token rotated longer ago than the grace window', () => {
      const lateWith = (rotatedTo: SuccessorState | null): RevocationState => ({
        ...rotatedAgo(REFRESH_REUSE_GRACE_MS + 1000),
        rotatedTo,
      });

      it('reads the row and its successor together, under the lock', async () => {
        spyOnLogger('warn');
        const { prisma, token, service } = await spentToken(
          lateWith(successor(RefreshTokenRevocation.ROTATED)),
        );

        await rejectionOf(service.rotateSession(token));

        expect(prisma.tx.refreshToken.findUnique).toHaveBeenCalledWith({
          where: { id: 'rt_1' },
          select: {
            revokedAt: true,
            revokedReason: true,
            rotatedTo: { select: { id: true, revokedReason: true } },
          },
        });
        expect(order(prisma.tx.$queryRaw)).toBeLessThan(
          order(prisma.tx.refreshToken.findUnique),
        );
      });

      describe.each([
        ['refreshed with', RefreshTokenRevocation.ROTATED],
        ['signed out with', RefreshTokenRevocation.SIGNED_OUT],
      ])('whose successor somebody %s', (_label, successorReason) => {
        // The successor reached somebody, who used it, and somebody else
        // still holds the token it replaced: two parties held the session.
        it('is treated as stolen: every session for the user is revoked, inside the transaction', async () => {
          const warn = spyOnLogger('warn');
          const { prisma, token, service } = await spentToken(
            lateWith(successor(successorReason)),
          );
          const { tx } = prisma;

          const error = await rejectionOf(service.rotateSession(token));

          expect(error).toBeInstanceOf(UnauthorizedException);
          // Not the race class: this browser's cookies are cleared.
          expect(error).not.toBeInstanceOf(RefreshRaceLostException);
          expect((error as UnauthorizedException).message).toBe(EXPIRED);
          expect(tx.refreshToken.updateMany.mock.calls[1][0]).toEqual(SWEEP);
          // Under the lock, so a refresh by the thief cannot slip a new row
          // in after the revoke and keep it.
          expect(order(tx.$queryRaw)).toBeLessThan(
            order(tx.refreshToken.updateMany),
          );
          expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
          expect(tx.refreshToken.create).not.toHaveBeenCalled();
          expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('revoked all sessions'),
          );
          expect(warn).toHaveBeenCalledWith(expect.stringContaining('user_1'));
        });
      });

      it('marks the presented token as answered, so replaying it later is just a dead token', async () => {
        // Otherwise the same stolen token, replayed after the owner signs in
        // again, would end their new sessions too, for as long as its JWT
        // lasts.
        spyOnLogger('warn');
        const { prisma, token, service } = await spentToken(
          lateWith(successor(RefreshTokenRevocation.ROTATED)),
        );

        await rejectionOf(service.rotateSession(token));

        expect(prisma.tx.refreshToken.updateMany).toHaveBeenCalledTimes(3);
        expect(prisma.tx.refreshToken.updateMany.mock.calls[2][0]).toEqual({
          where: { id: 'rt_1' },
          data: { revokedReason: RefreshTokenRevocation.REUSE_DETECTED },
        });
      });

      it('rotated before successors were recorded: cannot tell, so treated as stolen', async () => {
        spyOnLogger('warn');
        const { prisma, token, service } = await spentToken(lateWith(null));

        const error = await rejectionOf(service.rotateSession(token));

        expect(error).not.toBeInstanceOf(RefreshRaceLostException);
        expect(prisma.tx.refreshToken.updateMany.mock.calls[1][0]).toEqual(
          SWEEP,
        );
      });

      it('counts from the moment the window closes, exactly', async () => {
        const now = Date.UTC(2026, 10, 3, 9, 0, 0);
        freezeClockAt(now);
        spyOnLogger('warn');
        const { prisma, token, service } = await spentToken({
          ...rotatedAgo(REFRESH_REUSE_GRACE_MS, now),
          rotatedTo: successor(RefreshTokenRevocation.ROTATED),
        });

        await rejectionOf(service.rotateSession(token));

        expect(prisma.tx.refreshToken.updateMany.mock.calls[1]?.[0]).toEqual(
          SWEEP,
        );
      });

      describe.each([
        ['still live, as when the response carrying it was lost', null],
        ['ended by a password reset', RefreshTokenRevocation.PASSWORD_RESET],
        [
          'ended by an earlier reuse response',
          RefreshTokenRevocation.REUSE_DETECTED,
        ],
      ])('whose successor nobody used: %s', (_label, successorReason) => {
        // A refresh won but its answer never arrived, so the browser still
        // holds this token. Or a thief holds it and the owner has not
        // refreshed since. Either way only this session is at stake.
        it('ends that one session: the successor is revoked, nothing else, and cookies are cleared', async () => {
          const warn = spyOnLogger('warn');
          const { prisma, token, service } = await spentToken(
            lateWith(successor(successorReason)),
          );
          const { tx } = prisma;

          const error = await rejectionOf(service.rotateSession(token));

          expect(error).toBeInstanceOf(UnauthorizedException);
          expect(error).not.toBeInstanceOf(RefreshRaceLostException);
          expect((error as UnauthorizedException).message).toBe(EXPIRED);
          // The failed claim, then the successor, if it is still live.
          expect(tx.refreshToken.updateMany).toHaveBeenCalledTimes(2);
          expect(tx.refreshToken.updateMany.mock.calls[1][0]).toEqual({
            where: { id: 'rt_next', revokedAt: null },
            data: {
              revokedAt: expect.any(Date) as Date,
              revokedReason: RefreshTokenRevocation.REUSE_DETECTED,
            },
          });
          expect(tx.refreshToken.create).not.toHaveBeenCalled();
          expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
          expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('ended that session only'),
          );
        });
      });
    });

    describe.each([
      ['signed out', RefreshTokenRevocation.SIGNED_OUT],
      ['ended by a password reset', RefreshTokenRevocation.PASSWORD_RESET],
      [
        'ended by an earlier theft response',
        RefreshTokenRevocation.REUSE_DETECTED,
      ],
      ['revoked before reasons were recorded', null],
    ])('a token %s, presented long after', (_label, revokedReason) => {
      // A laptop tab left open across a reset or sign-out on another device.
      // Not theft: the user's newer sessions must survive it.
      it('is a dead token: 401 with cookies cleared, and nothing else revoked', async () => {
        const warn = spyOnLogger('warn');
        const { prisma, token, service } = await spentToken({
          revokedAt: new Date(Date.now() - 60 * 60 * 1000),
          revokedReason,
        });

        const error = await rejectionOf(service.rotateSession(token));

        expect(error).toBeInstanceOf(UnauthorizedException);
        expect(error).not.toBeInstanceOf(RefreshRaceLostException);
        expect((error as UnauthorizedException).message).toBe(EXPIRED);
        expect(prisma.tx.refreshToken.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.tx.refreshToken.create).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
      });
    });
  });

  describe('revokeSession', () => {
    it.each([undefined, ''])(
      'does nothing when no token is presented (%p)',
      async (token) => {
        const { prisma, service } = setup();

        await expect(service.revokeSession(token)).resolves.toBeUndefined();

        expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      },
    );

    it('revokes the live row matching the token hash, as signed out', async () => {
      const { prisma, service } = setup();

      await service.revokeSession('presented-refresh-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash: sha256('presented-refresh-token'),
          revokedAt: null,
        },
        data: {
          revokedAt: expect.any(Date) as Date,
          revokedReason: RefreshTokenRevocation.SIGNED_OUT,
        },
      });
    });
  });

  describe('requestPasswordReset', () => {
    it('quietly does nothing for an unknown email', async () => {
      const { prisma, service } = setup();
      const log = spyOnLogger('log');
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.requestPasswordReset('nobody@example.com'),
      ).resolves.toBeUndefined();

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it('stores only a hash of the reset token, expiring in one hour', async () => {
      const { prisma, tokens, service } = setup();
      spyOnLogger('log');
      jest.spyOn(tokens, 'randomToken').mockReturnValue('known-reset-token');
      prisma.user.findUnique.mockResolvedValue(makeUser());
      const before = Date.now();

      await service.requestPasswordReset('jane@example.com');

      const after = Date.now();
      const { data } = prisma.passwordResetToken.create.mock.calls[0][0];
      expect(data.userId).toBe('user_1');
      expect(data.tokenHash).toBe(sha256('known-reset-token'));
      expect(JSON.stringify(data)).not.toContain('known-reset-token');
      const expiresAt = (data.expiresAt as Date).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + ONE_HOUR_MS);
      expect(expiresAt).toBeLessThanOrEqual(after + ONE_HOUR_MS);
    });

    it.each(['development', 'test'])(
      'logs a working reset link when NODE_ENV is %s',
      async (nodeEnv) => {
        const { prisma, service } = setup({ NODE_ENV: nodeEnv });
        const log = spyOnLogger('log');
        prisma.user.findUnique.mockResolvedValue(makeUser());

        await service.requestPasswordReset('jane@example.com');

        expect(log).toHaveBeenCalledTimes(1);
        const message: unknown = log.mock.calls[0][0];
        const link = /(https?:\/\/\S+)$/.exec(String(message))?.[1] ?? '';
        const url = new URL(link);
        expect(`${url.origin}${url.pathname}`).toBe(
          `${APP_URL}/reset-password`,
        );
        // The link must carry the raw token whose hash was stored, or the
        // emailed link could never be redeemed.
        const token = url.searchParams.get('token') ?? '';
        expect(sha256(token)).toBe(
          prisma.passwordResetToken.create.mock.calls[0][0].data.tokenHash,
        );
      },
    );

    // An allow-list, not "anything but production": a value nobody planned
    // for must keep the link (a live credential) out of the log.
    it.each(['production', 'staging', 'Development', '', undefined])(
      'never writes the reset token to the logs when NODE_ENV is %p',
      async (nodeEnv) => {
        const { prisma, tokens, service } = setup({ NODE_ENV: nodeEnv });
        const levels = (
          ['log', 'warn', 'error', 'debug', 'verbose'] as const
        ).map(spyOnLogger);
        jest.spyOn(tokens, 'randomToken').mockReturnValue('known-reset-token');
        prisma.user.findUnique.mockResolvedValue(makeUser());

        await service.requestPasswordReset('jane@example.com');

        expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
        for (const spy of levels) {
          expect(spy).not.toHaveBeenCalled();
        }
      },
    );
  });

  describe('resetPassword', () => {
    const INVALID = 'That reset link is invalid or has expired';

    function resetRecord(
      overrides: Partial<PasswordResetToken> = {},
    ): PasswordResetToken {
      return {
        id: 'prt_1',
        userId: 'user_1',
        tokenHash: sha256('reset-token-value'),
        expiresAt: new Date(Date.now() + ONE_HOUR_MS),
        usedAt: null,
        createdAt: new Date(),
        ...overrides,
      };
    }

    it.each([
      ['unknown', null],
      ['already used', resetRecord({ usedAt: new Date(Date.now() - 1000) })],
      ['expired', resetRecord({ expiresAt: new Date(Date.now() - 1000) })],
    ])(
      'rejects an %s token with one message and writes nothing',
      async (_label, record) => {
        const { prisma, service } = setup();
        prisma.passwordResetToken.findUnique.mockResolvedValue(record);

        const error = await rejectionOf(
          service.resetPassword('reset-token-value', 'new password 123'),
        );

        expect(error).toBeInstanceOf(UnauthorizedException);
        expect((error as UnauthorizedException).message).toBe(INVALID);
        expect(argon2.hash).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.user.update).not.toHaveBeenCalled();
      },
    );

    it('looks the token up by its hash, not its raw value', async () => {
      const { prisma, service } = setup();
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await rejectionOf(
        service.resetPassword('reset-token-value', 'new password 123'),
      );

      expect(prisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: sha256('reset-token-value') },
      });
    });

    it('spends the token, changes the password and ends every session, all inside one transaction', async () => {
      const { prisma, service } = setup();
      const { tx } = prisma;
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetRecord());
      tx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

      await service.resetPassword('reset-token-value', 'new password 123');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Every write went through the transaction client; one made on the
      // root client would survive a rollback.
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.passwordResetToken.update).not.toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();

      const claim = tx.passwordResetToken.updateMany.mock.calls[0][0];
      expect(claim).toEqual({
        where: {
          id: 'prt_1',
          usedAt: null,
          expiresAt: { gt: expect.any(Date) as Date },
        },
        data: { usedAt: expect.any(Date) as Date },
      });

      const userUpdate = tx.user.update.mock.calls[0][0];
      expect(userUpdate.where).toEqual({ id: 'user_1' });
      const newHash = userUpdate.data.passwordHash as string;
      expect(newHash).toMatch(/^\$argon2id\$/);
      await expect(
        realArgon2.verify(newHash, 'new password 123'),
      ).resolves.toBe(true);

      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user_1', revokedAt: null },
        data: {
          revokedAt: expect.any(Date) as Date,
          revokedReason: RefreshTokenRevocation.PASSWORD_RESET,
        },
      });

      // The user's lock first, then the claim, so nothing else is written
      // unless it won.
      expect(lockQuery(tx).values).toEqual(['user_1']);
      expect(order(tx.$queryRaw)).toBeLessThan(
        order(tx.passwordResetToken.updateMany),
      );
      expect(order(tx.passwordResetToken.updateMany)).toBeLessThan(
        order(tx.user.update),
      );
      expect(order(tx.user.update)).toBeLessThan(
        order(tx.refreshToken.updateMany),
      );
    });

    it("voids the user's other unused reset links in the same transaction", async () => {
      // Otherwise an older link from a second request could change the
      // password again within its hour, locking the owner out.
      const { prisma, service } = setup();
      const { tx } = prisma;
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetRecord());
      tx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

      await service.resetPassword('reset-token-value', 'new password 123');

      expect(tx.passwordResetToken.updateMany).toHaveBeenCalledTimes(2);
      const [claim, siblings] = tx.passwordResetToken.updateMany.mock.calls;
      expect(siblings[0]).toEqual({
        where: { userId: 'user_1', usedAt: null },
        data: { usedAt: claim[0].data.usedAt },
      });
    });

    it('hashes the new password before opening the transaction', async () => {
      // argon2 takes tens of milliseconds; inside the transaction it would
      // hold a connection and the token's row lock for all of them.
      const { prisma, service } = setup();
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetRecord());
      prisma.tx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

      await service.resetPassword('reset-token-value', 'new password 123');

      const hashMock = argon2.hash as unknown as jest.Mock;
      expect(hashMock).toHaveBeenCalledTimes(1);
      expect(hashMock.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$transaction.mock.invocationCallOrder[0],
      );
    });

    it('refuses with the same message, and writes nothing more, when a concurrent request spent the token first', async () => {
      const { prisma, service } = setup();
      const { tx } = prisma;
      // The read saw a live token; by the time of the claim it was gone.
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetRecord());
      tx.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

      const error = await rejectionOf(
        service.resetPassword('reset-token-value', 'new password 123'),
      );

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(INVALID);
      // Thrown from inside the callback, which is what makes Prisma roll back.
      await expect(
        prisma.$transaction.mock.results[0].value as Promise<unknown>,
      ).rejects.toBe(error);
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.refreshToken.updateMany).not.toHaveBeenCalled();
      // Only the failed claim: the other links stay as they were.
      expect(tx.passwordResetToken.updateMany).toHaveBeenCalledTimes(1);
    });
  });
});
