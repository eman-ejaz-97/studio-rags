import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * scripts/assert-test-database.js runs before `prisma migrate deploy` in
 * test:e2e:prepare. It is plain CommonJS so it can run before anything is
 * built, which also means nothing else imports it: these tests run it the way
 * npm does, as its own process, and read the exit code.
 *
 * Lives under src/ only because that is Jest's unit-test root, as with
 * seed-guard.spec.ts.
 */
const SCRIPT = path.resolve(__dirname, '../../scripts/assert-test-database.js');

const PASSWORD = 'not-a-real-password-9f3a';
const url = (database: string, query = '') =>
  `postgresql://studio:${PASSWORD}@localhost:5433/${database}${query}`;

const TEST_DB = url('studio_rags_test');
const DEV_DB = url('studio_rags');

/**
 * Runs the script with exactly these variables and nothing inherited, so a
 * DATABASE_URL in the shell running Jest cannot change the answer.
 */
function run(env: Record<string, string | undefined>) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

describe('scripts/assert-test-database.js', () => {
  it('accepts two test database URLs', () => {
    const { status, output } = run({
      DATABASE_URL: TEST_DB,
      DATABASE_URL_UNPOOLED: TEST_DB,
    });

    expect(status).toBe(0);
    expect(output).toContain('DATABASE_URL: database "studio_rags_test"');
    expect(output).toContain(
      'DATABASE_URL_UNPOOLED: database "studio_rags_test"',
    );
  });

  it.each([
    ['unset', undefined],
    ['empty', ''],
  ])(
    'accepts a test DATABASE_URL with DATABASE_URL_UNPOOLED %s',
    (_label, unpooled) => {
      expect(
        run({ DATABASE_URL: TEST_DB, DATABASE_URL_UNPOOLED: unpooled }).status,
      ).toBe(0);
    },
  );

  it.each([
    [
      'the dev database',
      { DATABASE_URL: DEV_DB, DATABASE_URL_UNPOOLED: DEV_DB },
    ],
    ['the dev database, with no direct URL', { DATABASE_URL: DEV_DB }],
    [
      // Prisma Migrate connects through directUrl, so this is the variable
      // that decides which database the migration actually touches.
      'a test DATABASE_URL but the dev DATABASE_URL_UNPOOLED',
      { DATABASE_URL: TEST_DB, DATABASE_URL_UNPOOLED: DEV_DB },
    ],
    [
      'a dev DATABASE_URL but a test DATABASE_URL_UNPOOLED',
      { DATABASE_URL: DEV_DB, DATABASE_URL_UNPOOLED: TEST_DB },
    ],
    ['no DATABASE_URL at all', { DATABASE_URL_UNPOOLED: TEST_DB }],
    ['an empty DATABASE_URL', { DATABASE_URL: '' }],
    ['a value that is not a URL', { DATABASE_URL: 'studio_rags_test' }],
    [
      'a ?dbname= override, which libpq prefers to the path',
      { DATABASE_URL: url('studio_rags_test', '?dbname=studio_rags') },
    ],
    [
      'a name that only contains _test',
      { DATABASE_URL: url('studio_rags_test_copy') },
    ],
    ['no database name', { DATABASE_URL: url('') }],
  ])('refuses %s with exit code 1', (_label, env) => {
    const { status, output } = run(env);

    expect(status).toBe(1);
    expect(output).toContain('REFUSING TO PREPARE THE E2E DATABASE');
  });

  it('never prints the password, whether it accepts or refuses', () => {
    const accepted = run({
      DATABASE_URL: TEST_DB,
      DATABASE_URL_UNPOOLED: TEST_DB,
    });
    const refused = run({
      DATABASE_URL: TEST_DB,
      DATABASE_URL_UNPOOLED: DEV_DB,
    });

    expect(refused.output).toContain('"studio_rags" on localhost:5433');
    expect(accepted.output).not.toContain(PASSWORD);
    expect(refused.output).not.toContain(PASSWORD);
  });
});
