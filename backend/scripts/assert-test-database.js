#!/usr/bin/env node
/**
 * Refuses to continue unless DATABASE_URL (and DATABASE_URL_UNPOOLED, when
 * set) names a database ending in "_test".
 *
 * Runs before `prisma migrate deploy` in test:e2e:prepare. Migrating is not
 * destructive in itself, but the suite that follows truncates tables, and the
 * cheapest moment to catch a wrong URL is before anything has connected.
 * Prisma Migrate connects through directUrl, so that variable is checked too.
 *
 * Plain CommonJS with no dependencies, so it runs before `npm ci` has even
 * built anything. The same rule lives in test/utils/test-db-guard.ts for the
 * suite itself; keep the two in step.
 *
 * Never prints a URL: it carries the password. Host and database name only.
 */
'use strict';

const SUFFIX = '_test';
const VARIABLES = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'];

function refuse(reason) {
  const rule = '='.repeat(72);
  console.error(
    [
      '',
      rule,
      'REFUSING TO PREPARE THE E2E DATABASE: it is not a test database.',
      reason,
      `The database name must end in "${SUFFIX}".`,
      'Run it through `npm run test:e2e:prepare`, which loads backend/.env.test.',
      rule,
      '',
    ].join('\n'),
  );
  process.exit(1);
}

/** Returns the database name, or calls refuse(). */
function checkUrl(variable, raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return refuse(`${variable} is not a valid URL.`);
  }

  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const where = `${url.hostname}${url.port ? `:${url.port}` : ''}`;

  if (!name || name.includes('/')) {
    return refuse(`${variable} on ${where} does not name a single database.`);
  }
  // libpq honours ?dbname= over the path, so the path alone could mislead.
  if (url.searchParams.has('dbname')) {
    return refuse(
      `${variable} carries a ?dbname= parameter, which can override the path.`,
    );
  }
  if (!name.endsWith(SUFFIX)) {
    return refuse(`${variable} points at database "${name}" on ${where}.`);
  }
  return name;
}

function main() {
  if (!process.env.DATABASE_URL) {
    refuse('DATABASE_URL is not set.');
  }

  for (const variable of VARIABLES) {
    const raw = process.env[variable];
    // DATABASE_URL_UNPOOLED is optional here; prisma itself complains if a
    // schema needs it and it is missing.
    if (raw === undefined || raw === '') continue;
    const name = checkUrl(variable, raw);
    console.log(`${variable}: database "${name}" is a test database.`);
  }
}

main();
