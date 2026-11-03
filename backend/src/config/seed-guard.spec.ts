// The guard lives beside the seed in prisma/, which Jest does not search (its
// rootDir is src), so its spec lives here with the other configuration rules.
import {
  DEV_DEFAULT_ADMIN_PASSWORD,
  MIN_SEED_ADMIN_PASSWORD_LENGTH,
  isLocalDatabaseUrl,
  planExistingAccount,
  planSeedAdmin,
} from '../../prisma/seed-guard';

const LOCAL_URL = 'postgresql://studio:studio@localhost:5433/studio_rags';
const NEON_URL =
  'postgresql://owner:secret@ep-example-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const STRONG = 'a-real-admin-passphrase';

describe('seed guard', () => {
  describe('isLocalDatabaseUrl', () => {
    it.each([
      LOCAL_URL,
      'postgresql://u:p@127.0.0.1:5432/db',
      'postgresql://u:p@[::1]:5432/db',
      'postgres://u:p@LOCALHOST/db',
    ])('treats %p as local', (url) => {
      expect(isLocalDatabaseUrl(url)).toBe(true);
    });

    it.each([
      ['Neon', NEON_URL],
      ['a docker service name', 'postgresql://u:p@db:5432/studio_rags'],
      ['a lookalike host', 'postgresql://u:p@localhost.evil.example/db'],
      // libpq and Prisma connect to ?host= instead of the URL's own host.
      [
        'a ?host= override',
        'postgresql://u:p@localhost/db?host=prod.example.com',
      ],
      ['an unset variable', undefined],
      ['an empty variable', ''],
      ['a string that is not a URL', 'localhost'],
    ])('treats %s as remote', (_label, url) => {
      expect(isLocalDatabaseUrl(url)).toBe(false);
    });
  });

  describe('planSeedAdmin', () => {
    describe('without SEED_ADMIN_PASSWORD', () => {
      it('uses the development password for a local database', () => {
        expect(
          planSeedAdmin({ NODE_ENV: 'development', DATABASE_URL: LOCAL_URL }),
        ).toEqual({
          ok: true,
          password: DEV_DEFAULT_ADMIN_PASSWORD,
          usingDefaultPassword: true,
          rotatePassword: false,
        });
      });

      it('refuses when NODE_ENV is production, even on localhost', () => {
        const plan = planSeedAdmin({
          NODE_ENV: 'production',
          DATABASE_URL: LOCAL_URL,
        });

        expect(plan.ok).toBe(false);
        expect(plan).toMatchObject({
          reason: expect.stringContaining(
            'SEED_ADMIN_PASSWORD is not set and NODE_ENV is production',
          ) as string,
        });
      });

      it.each([
        ['Neon', NEON_URL],
        ['a docker service name', 'postgresql://u:p@db:5432/studio_rags'],
        ['no DATABASE_URL at all', undefined],
      ])('refuses a database that is not local: %s', (_label, url) => {
        const plan = planSeedAdmin({
          NODE_ENV: 'development',
          DATABASE_URL: url,
        });

        expect(plan.ok).toBe(false);
        expect(plan).toMatchObject({
          reason: expect.stringContaining(
            'DATABASE_URL does not point at localhost',
          ) as string,
        });
      });

      it('treats an empty value as unset, so the guard still applies', () => {
        expect(
          planSeedAdmin({ SEED_ADMIN_PASSWORD: '', DATABASE_URL: NEON_URL }).ok,
        ).toBe(false);
      });

      it('never echoes the connection string, which carries a password', () => {
        const plan = planSeedAdmin({ DATABASE_URL: NEON_URL });

        expect(JSON.stringify(plan)).not.toContain('secret');
      });
    });

    describe('with SEED_ADMIN_PASSWORD', () => {
      it('uses it, for any database and any NODE_ENV', () => {
        expect(
          planSeedAdmin({
            NODE_ENV: 'production',
            DATABASE_URL: NEON_URL,
            SEED_ADMIN_PASSWORD: STRONG,
          }),
        ).toEqual({
          ok: true,
          password: STRONG,
          usingDefaultPassword: false,
          rotatePassword: false,
        });
      });

      it('requires at least 12 characters', () => {
        const short = 'x'.repeat(MIN_SEED_ADMIN_PASSWORD_LENGTH - 1);

        expect(MIN_SEED_ADMIN_PASSWORD_LENGTH).toBe(12);
        expect(
          planSeedAdmin({
            DATABASE_URL: LOCAL_URL,
            SEED_ADMIN_PASSWORD: short,
          }),
        ).toEqual({
          ok: false,
          reason: 'SEED_ADMIN_PASSWORD must be at least 12 characters.',
        });
        expect(
          planSeedAdmin({
            DATABASE_URL: LOCAL_URL,
            SEED_ADMIN_PASSWORD: `${short}x`,
          }).ok,
        ).toBe(true);
      });

      it('never echoes the password in a refusal', () => {
        const plan = planSeedAdmin({ SEED_ADMIN_PASSWORD: 'short-pw' });

        expect(JSON.stringify(plan)).not.toContain('short-pw');
      });

      it('accepts the CI value, so the seed smoke test keeps passing', () => {
        const plan = planSeedAdmin({
          NODE_ENV: 'test',
          DATABASE_URL:
            'postgresql://studio:studio@localhost:5433/studio_rags_test',
          SEED_ADMIN_PASSWORD: 'ci-throwaway-password-not-used-anywhere',
        });

        expect(plan).toMatchObject({ ok: true, usingDefaultPassword: false });
      });
    });

    describe('SEED_ADMIN_ROTATE', () => {
      const base = { DATABASE_URL: LOCAL_URL, SEED_ADMIN_PASSWORD: STRONG };

      it.each([
        [undefined, false],
        ['', false],
        ['0', false],
        ['1', true],
      ])('reads %p as rotate=%p', (flag, rotate) => {
        expect(
          planSeedAdmin({ ...base, SEED_ADMIN_ROTATE: flag }),
        ).toMatchObject({ ok: true, rotatePassword: rotate });
      });

      // Anything else is refused: an operator who wrote "true" expects the
      // leaked password gone, and a quiet no-op would leave it in place.
      it.each(['true', 'yes', '2'])('refuses %p', (flag) => {
        expect(planSeedAdmin({ ...base, SEED_ADMIN_ROTATE: flag })).toEqual({
          ok: false,
          reason:
            'SEED_ADMIN_ROTATE must be 1 (replace the admin password) or unset.',
        });
      });
    });
  });

  describe('planExistingAccount', () => {
    it('keeps an existing admin password unless asked to rotate', () => {
      expect(planExistingAccount(true, false)).toEqual({ action: 'keep' });
      expect(planExistingAccount(true, true)).toEqual({ action: 'rotate' });
    });

    it('refuses to promote a non-admin account as it stands', () => {
      // Sign-up is open and the admin address is public, so this account may
      // be someone else's, with a password they chose.
      expect(planExistingAccount(false, false)).toMatchObject({
        action: 'refuse',
        reason: expect.stringContaining('SEED_ADMIN_ROTATE=1') as string,
      });
    });

    it('takes a non-admin account over only by replacing its password', () => {
      expect(planExistingAccount(false, true)).toEqual({ action: 'rotate' });
    });
  });
});
