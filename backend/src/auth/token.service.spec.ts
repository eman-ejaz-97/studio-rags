import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { TokenService } from './token.service';

const ACCESS_SECRET = 'unit-test-only-access-secret-not-for-real-use';
const REFRESH_SECRET = 'unit-test-only-refresh-secret-not-for-real-use';

const DAY_SECONDS = 24 * 60 * 60;

/**
 * A plain stub rather than a real ConfigService: the real one reads
 * process.env before its internal values, so a JWT_* variable exported in CI
 * or a developer's shell would silently change what these tests exercise.
 */
function configStub(values: Record<string, string>): ConfigService {
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

function createService(overrides: Record<string, string> = {}) {
  const jwt = new JwtService({});
  const tokens = new TokenService(
    jwt,
    configStub({
      JWT_ACCESS_SECRET: ACCESS_SECRET,
      JWT_REFRESH_SECRET: REFRESH_SECRET,
      JWT_ACCESS_TTL: '15m',
      JWT_REFRESH_TTL: '30d',
      ...overrides,
    }),
  );
  return { jwt, tokens };
}

describe('TokenService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('TTL parsing', () => {
    it.each([
      ['45s', 45_000],
      ['15m', 900_000],
      ['2h', 7_200_000],
      ['30d', 2_592_000_000],
    ])('reads JWT_ACCESS_TTL=%s as %d ms', (ttl, expected) => {
      const { tokens } = createService({ JWT_ACCESS_TTL: ttl });
      expect(tokens.accessTtlMs()).toBe(expected);
    });

    it.each([
      ['90s', 90_000],
      ['30m', 1_800_000],
      ['12h', 43_200_000],
      ['7d', 604_800_000],
    ])('reads JWT_REFRESH_TTL=%s as %d ms', (ttl, expected) => {
      const { tokens } = createService({ JWT_REFRESH_TTL: ttl });
      expect(tokens.refreshTtlMs()).toBe(expected);
    });

    it('reads each lifetime from its own variable', () => {
      // Swapped keys would hand out 30-day access tokens, so pin them apart.
      const { tokens } = createService({
        JWT_ACCESS_TTL: '15m',
        JWT_REFRESH_TTL: '30d',
      });
      expect(tokens.accessTtlMs()).toBe(15 * 60_000);
      expect(tokens.refreshTtlMs()).toBe(30 * DAY_SECONDS * 1000);
    });

    it('tolerates surrounding whitespace from a hand-edited env file', () => {
      const { tokens } = createService({
        JWT_ACCESS_TTL: '  15m\t',
        JWT_REFRESH_TTL: '\n30d ',
      });
      expect(tokens.accessTtlMs()).toBe(900_000);
      expect(tokens.refreshTtlMs()).toBe(2_592_000_000);
    });

    it('allows a space between the number and the unit', () => {
      const { tokens } = createService({ JWT_ACCESS_TTL: '15 m' });
      expect(tokens.accessTtlMs()).toBe(900_000);
    });

    it.each(['15', 'm', '15min', '1.5h', '-5m', '15M', '2w', '', 'm15'])(
      'rejects %p with a message naming the bad value and the expected shape',
      (ttl) => {
        const { tokens } = createService({ JWT_ACCESS_TTL: ttl });
        expect(() => tokens.accessTtlMs()).toThrow(
          `Unsupported duration format: "${ttl}". Use e.g. 15m, 30d.`,
        );
      },
    );

    it('names the variable when it is missing, instead of a bare TypeError', () => {
      const tokens = new TokenService(new JwtService({}), configStub({}));
      expect(() => tokens.refreshTtlMs()).toThrow('JWT_REFRESH_TTL');
    });
  });

  describe('hash()', () => {
    it('is SHA-256 as lower-case hex (checked against the FIPS 180-2 "abc" vector)', () => {
      const { tokens } = createService();
      expect(tokens.hash('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('is deterministic, so a presented token can be looked up by its hash', () => {
      const { tokens } = createService();
      const token = tokens.randomToken();
      expect(tokens.hash(token)).toBe(tokens.hash(token));
      expect(tokens.hash(token)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('never returns the input, so the raw token is not what gets stored', () => {
      const { tokens } = createService();
      const token = tokens.randomToken();
      expect(tokens.hash(token)).not.toBe(token);
      expect(tokens.hash(token)).not.toContain(token);
    });

    it('gives different hashes for different inputs', () => {
      const { tokens } = createService();
      expect(tokens.hash('token-a')).not.toBe(tokens.hash('token-b'));
    });
  });

  describe('randomToken()', () => {
    it('is 43 base64url characters carrying 32 bytes of entropy', () => {
      const { tokens } = createService();
      const token = tokens.randomToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    });

    it('does not repeat across calls', () => {
      const { tokens } = createService();
      const seen = new Set(
        Array.from({ length: 1000 }, () => tokens.randomToken()),
      );
      expect(seen.size).toBe(1000);
    });
  });

  describe('access tokens', () => {
    it('carry the identity claims and live for the access TTL', async () => {
      const { jwt, tokens } = createService({ JWT_ACCESS_TTL: '15m' });
      const token = await tokens.signAccessToken({
        sub: 'user_1',
        email: 'jane@example.com',
        role: Role.ADMIN,
      });

      const payload = await jwt.verifyAsync<{
        sub: string;
        email: string;
        role: Role;
        iat: number;
        exp: number;
      }>(token, { secret: ACCESS_SECRET });

      expect(payload).toMatchObject({
        sub: 'user_1',
        email: 'jane@example.com',
        role: Role.ADMIN,
        typ: 'access',
      });
      // Seconds, not milliseconds: jsonwebtoken reads a numeric expiresIn as
      // seconds, so passing ms straight through would mean 1000x the lifetime.
      expect(payload.exp - payload.iat).toBe(15 * 60);
    });

    it('carry only the identity claims and typ, whatever else the caller passes', async () => {
      const { jwt, tokens } = createService();
      const token = await tokens.signAccessToken({
        sub: 'user_1',
        email: 'jane@example.com',
        role: Role.CUSTOMER,
        typ: 'refresh',
        passwordHash: 'should-never-be-signed',
      } as unknown as Parameters<TokenService['signAccessToken']>[0]);

      const payload = await jwt.verifyAsync<Record<string, unknown>>(token, {
        secret: ACCESS_SECRET,
      });

      expect(Object.keys(payload).sort()).toEqual(
        ['email', 'exp', 'iat', 'role', 'sub', 'typ'].sort(),
      );
      expect(payload.typ).toBe('access');
    });
  });

  describe('refresh tokens', () => {
    it('round-trip through verifyRefreshToken with the same subject and jti', async () => {
      const { tokens } = createService();
      const { token, jti } = await tokens.signRefreshToken('user_1');

      const payload = await tokens.verifyRefreshToken(token);

      expect(payload.sub).toBe('user_1');
      expect(payload.jti).toBe(jti);
      expect(payload.typ).toBe('refresh');
      expect(jti).toMatch(/^[0-9a-f]{48}$/);
    });

    describe('with both secrets set to the same value', () => {
      // validateEnv refuses this at boot. These prove the typ claim still
      // keeps the two kinds apart if that check were ever bypassed.
      const shared = { JWT_REFRESH_SECRET: ACCESS_SECRET };

      it('rejects an access token presented as a refresh token', async () => {
        const { tokens } = createService(shared);
        const accessToken = await tokens.signAccessToken({
          sub: 'user_1',
          email: 'jane@example.com',
          role: Role.CUSTOMER,
        });

        await expect(tokens.verifyRefreshToken(accessToken)).rejects.toThrow(
          'jwt is not a refresh token',
        );
      });

      it('rejects a token with no typ at all, as issued before the claim existed', async () => {
        const { jwt, tokens } = createService(shared);
        const legacy = await jwt.signAsync(
          { sub: 'user_1', jti: 'a'.repeat(48) },
          { secret: ACCESS_SECRET, expiresIn: 3600 },
        );

        await expect(tokens.verifyRefreshToken(legacy)).rejects.toMatchObject({
          name: 'JsonWebTokenError',
        });
      });

      it('still accepts its own refresh tokens', async () => {
        const { tokens } = createService(shared);
        const { token } = await tokens.signRefreshToken('user_1');

        await expect(tokens.verifyRefreshToken(token)).resolves.toMatchObject({
          sub: 'user_1',
          typ: 'refresh',
        });
      });
    });

    it('live for the refresh TTL', async () => {
      const { tokens } = createService({ JWT_REFRESH_TTL: '30d' });
      const { token } = await tokens.signRefreshToken('user_1');

      const payload = (await tokens.verifyRefreshToken(token)) as unknown as {
        iat: number;
        exp: number;
      };

      expect(payload.exp - payload.iat).toBe(30 * DAY_SECONDS);
    });

    it('differ for the same user signed in the same second', async () => {
      // tokenHash is unique in the database. Without the jti, two sign-ins in
      // one second would produce byte-identical tokens and the second insert
      // would fail.
      const { tokens } = createService();
      jest.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 3, 9, 0, 0));

      const first = await tokens.signRefreshToken('user_1');
      const second = await tokens.signRefreshToken('user_1');

      expect(second.token).not.toBe(first.token);
      expect(tokens.hash(second.token)).not.toBe(tokens.hash(first.token));
    });

    it('rejects an access token presented as a refresh token', async () => {
      const { tokens } = createService();
      const accessToken = await tokens.signAccessToken({
        sub: 'user_1',
        email: 'jane@example.com',
        role: Role.CUSTOMER,
      });

      await expect(tokens.verifyRefreshToken(accessToken)).rejects.toThrow(
        'invalid signature',
      );
    });

    it('cannot be used as an access token, because it is signed with the other secret', async () => {
      const { jwt, tokens } = createService();
      const { token } = await tokens.signRefreshToken('user_1');

      // This is the check JwtStrategy makes on every protected request.
      await expect(
        jwt.verifyAsync(token, { secret: ACCESS_SECRET }),
      ).rejects.toThrow('invalid signature');
    });

    it('rejects a token whose exp is in the past', async () => {
      const { jwt, tokens } = createService();
      const expired = await jwt.signAsync(
        {
          sub: 'user_1',
          jti: 'a'.repeat(48),
          typ: 'refresh',
          exp: Math.floor(Date.now() / 1000) - 60,
        },
        { secret: REFRESH_SECRET },
      );

      await expect(tokens.verifyRefreshToken(expired)).rejects.toMatchObject({
        name: 'TokenExpiredError',
      });
    });

    it('stops verifying once the configured lifetime has passed', async () => {
      const { tokens } = createService({ JWT_REFRESH_TTL: '1h' });
      const issuedAt = Date.UTC(2026, 10, 3, 9, 0, 0);
      const clock = jest.spyOn(Date, 'now').mockReturnValue(issuedAt);
      const { token } = await tokens.signRefreshToken('user_1');

      clock.mockReturnValue(issuedAt + 59 * 60_000);
      await expect(tokens.verifyRefreshToken(token)).resolves.toMatchObject({
        sub: 'user_1',
      });

      clock.mockReturnValue(issuedAt + 61 * 60_000);
      await expect(tokens.verifyRefreshToken(token)).rejects.toMatchObject({
        name: 'TokenExpiredError',
      });
    });
  });
});
