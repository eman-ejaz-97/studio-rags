/**
 * The one rule this suite must never break: it only ever writes to a database
 * whose name ends in "_test".
 *
 * Why a guard is needed at all: AppModule's ConfigModule reads ../.env (the
 * developer's real dev file) and copies every variable that is not already set
 * into process.env. Run the suite without `dotenv -e .env.test` and
 * DATABASE_URL silently becomes the dev database, which the suite would then
 * truncate before every test.
 */
export const TEST_DATABASE_SUFFIX = '_test';

export class UnsafeTestDatabaseError extends Error {
  constructor(reason: string) {
    const rule = '='.repeat(72);
    super(
      [
        '',
        rule,
        'REFUSING TO RUN THE E2E SUITE: it would write to a non-test database.',
        reason,
        `The database name must end in "${TEST_DATABASE_SUFFIX}".`,
        'Run it through `npm run test:e2e`, which loads backend/.env.test.',
        rule,
      ].join('\n'),
    );
    this.name = 'UnsafeTestDatabaseError';
  }
}

/**
 * Throws unless the URL names a "_test" database. Returns the database name.
 * Error messages name the host and database but never echo the URL itself,
 * because it carries the password.
 */
export function assertTestDatabaseUrl(raw: string | undefined): string {
  if (!raw) {
    throw new UnsafeTestDatabaseError('DATABASE_URL is not set.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeTestDatabaseError('DATABASE_URL is not a valid URL.');
  }

  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const where = `${url.hostname}${url.port ? `:${url.port}` : ''}`;

  if (!name || name.includes('/')) {
    throw new UnsafeTestDatabaseError(
      `DATABASE_URL on ${where} does not name a single database.`,
    );
  }

  // libpq honours ?dbname= over the path, so a URL could look like a test
  // database to this check while psql or another tool connects elsewhere.
  if (url.searchParams.has('dbname')) {
    throw new UnsafeTestDatabaseError(
      'DATABASE_URL carries a ?dbname= parameter, which can override the path.',
    );
  }

  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new UnsafeTestDatabaseError(
      `DATABASE_URL points at database "${name}" on ${where}.`,
    );
  }

  return name;
}
