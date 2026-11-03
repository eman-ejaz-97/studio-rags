import { ConfigService } from '@nestjs/config';
import { PASSWORD } from './utils/auth';
import { currentDatabase, useTestApp } from './utils/test-app';
import {
  UnsafeTestDatabaseError,
  assertTestDatabaseUrl,
} from './utils/test-db-guard';

describe('e2e harness', () => {
  describe('test database guard', () => {
    it.each([
      ['the test database', 'postgresql://u:p@localhost:5433/studio_rags_test'],
      [
        'a schema parameter',
        'postgresql://u:p@localhost/studio_rags_test?schema=public',
      ],
      ['the postgres:// scheme', 'postgres://u:p@db:5432/anything_test'],
    ])('accepts %s', (_label, url) => {
      expect(() => assertTestDatabaseUrl(url)).not.toThrow();
    });

    it.each([
      ['an unset variable', undefined],
      ['an empty variable', ''],
      ['a string that is not a URL', 'studio_rags_test'],
      ['the dev database', 'postgresql://u:p@localhost:5433/studio_rags'],
      [
        'a name that only contains _test',
        'postgresql://u:p@localhost/studio_rags_test_copy',
      ],
      ['an upper-case suffix', 'postgresql://u:p@localhost/studio_rags_TEST'],
      ['no database name', 'postgresql://u:p@localhost:5433/'],
      ['a nested path', 'postgresql://u:p@localhost/studio_rags/x_test'],
      [
        'a ?dbname= override',
        'postgresql://u:p@localhost/x_test?dbname=studio_rags',
      ],
    ])('rejects %s', (_label, url) => {
      expect(() => assertTestDatabaseUrl(url)).toThrow(UnsafeTestDatabaseError);
    });

    it('names the database but never echoes the password', () => {
      const attempt = () =>
        assertTestDatabaseUrl(
          'postgresql://studio:hunter2-secret@prod.example.com:5432/studio_rags',
        );
      expect(attempt).toThrow(/"studio_rags" on prod\.example\.com:5432/);
      expect(attempt).not.toThrow(/hunter2-secret/);
    });
  });

  describe('the running app', () => {
    const ctx = useTestApp();

    it('is connected to the database named in .env.test, not the dev one', async () => {
      const t = ctx();
      const expected = assertTestDatabaseUrl(process.env.DATABASE_URL);

      await expect(currentDatabase(t.prisma)).resolves.toBe(expected);
      // ConfigModule read ../.env too; process.env must still have won.
      expect(t.app.get(ConfigService).get('DATABASE_URL')).toBe(
        process.env.DATABASE_URL,
      );
    });

    it('resets the auth tables between tests', async () => {
      const t = ctx();
      const user = await t.prisma.user.create({
        data: {
          email: 'leftover@example.com',
          passwordHash: PASSWORD,
          firstName: 'Left',
          lastName: 'Over',
        },
      });
      await t.prisma.refreshToken.create({
        data: { userId: user.id, tokenHash: 'x', expiresAt: new Date() },
      });

      await t.resetDatabase();

      await expect(t.prisma.user.count()).resolves.toBe(0);
      await expect(t.prisma.refreshToken.count()).resolves.toBe(0);
    });
  });
});
