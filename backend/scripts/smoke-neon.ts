/**
 * End-to-end smoke test for a REAL deployment environment: Neon staging
 * today, real AWS (RDS + S3) if the project moves there later.
 *
 * It reads only the environment it is given, and loads no .env file itself,
 * so it always tests exactly what the caller points it at. From backend/:
 *
 *   set -a; . ../.env.local; set +a; npm run smoke:neon
 *
 * Checks, each printed as PASS or FAIL:
 *   database   the pooled DATABASE_URL connects; prints the database name,
 *              the server version and how many migrations are applied
 *   direct     DATABASE_URL_UNPOOLED (what Prisma Migrate uses) connects
 *   storage    puts a uniquely named text object under smoke/, then exists,
 *              presigned GET with plain fetch, get, delete, exists again
 *
 * Writes nothing to the database. The test object is always deleted, even
 * when a step fails. Exits 1 if any step failed.
 *
 * Never prints a secret: no URLs (a presigned URL carries the access key id
 * and a live signature), and every message is scrubbed of the credential
 * values before it is printed, in case a driver error ever echoes one.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readStorageConfig } from '../src/storage/storage.config';
import { StorageService } from '../src/storage/storage.service';

const MIGRATIONS_DIR = join(__dirname, '..', 'prisma', 'migrations');
const FETCH_TIMEOUT_MS = 15_000;

let failures = 0;

// ─── Output ─────────────────────────────────────────────────────────────────

const secrets = collectSecrets();

function collectSecrets(): string[] {
  const values = [
    process.env.AWS_SECRET_ACCESS_KEY,
    process.env.AWS_ACCESS_KEY_ID,
  ];
  for (const name of ['DATABASE_URL', 'DATABASE_URL_UNPOOLED']) {
    const raw = process.env[name];
    if (!raw) continue;
    values.push(raw);
    try {
      const url = new URL(raw);
      values.push(url.password, decodeURIComponent(url.password));
    } catch {
      // Not a URL: the whole value is already on the list.
    }
  }
  // Longest first, so a password inside a URL cannot leave half a URL behind.
  // A short local password such as "studio" also blanks matching text in
  // names; harmless, and real Neon passwords are long and random.
  return values
    .filter((v): v is string => typeof v === 'string' && v.length >= 4)
    .sort((a, b) => b.length - a.length);
}

function scrub(text: string): string {
  return secrets.reduce((out, secret) => out.split(secret).join('***'), text);
}

function say(line: string): void {
  console.log(scrub(line));
}

function pass(step: string, detail = ''): void {
  say(`PASS  ${step}${detail ? `  ${detail}` : ''}`);
}

function fail(step: string, err: unknown): void {
  failures += 1;
  say(`FAIL  ${step}  ${describeError(err)}`);
}

function warn(step: string, detail: string): void {
  say(`WARN  ${step}  ${detail}`);
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const { $metadata, errorCode } = err as {
      $metadata?: { httpStatusCode?: number };
      errorCode?: string;
    };
    const tag = $metadata?.httpStatusCode
      ? ` (HTTP ${$metadata.httpStatusCode})`
      : errorCode
        ? ` (${errorCode})`
        : '';
    // Prisma spreads one error over several lines; keep it on one.
    const message = err.message.replace(/\s+/g, ' ').trim().slice(0, 400);
    return `${err.name}${tag}: ${message}`;
  }
  return String(err);
}

/** Runs one step. A failure is recorded and printed, never thrown. */
async function step<T>(
  name: string,
  run: () => Promise<T>,
  detail?: (result: T) => string,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    const value = await run();
    pass(name, detail ? detail(value) : '');
    return { ok: true, value };
  } catch (err) {
    fail(name, err);
    return { ok: false };
  }
}

function hostKind(variable: string): string {
  const raw = process.env[variable];
  if (!raw) return 'unset';
  try {
    // Neon's pooled hosts carry a "-pooler" suffix on the endpoint id.
    return new URL(raw).hostname.includes('-pooler')
      ? 'pooled host'
      : 'direct host';
  } catch {
    return 'not a URL';
  }
}

// ─── Database ───────────────────────────────────────────────────────────────

async function checkDatabase(): Promise<void> {
  say('\nDatabase');

  if (!process.env.DATABASE_URL) {
    fail('database', new Error('DATABASE_URL is not set.'));
    return;
  }

  const prisma = new PrismaClient();
  try {
    const connected = await step(
      `database: connect over DATABASE_URL (${hostKind('DATABASE_URL')})`,
      async () => {
        const [row] = await prisma.$queryRaw<
          { database: string; version: string }[]
        >`SELECT current_database() AS database, current_setting('server_version') AS version`;
        return row;
      },
      (row) => `database "${row.database}", PostgreSQL ${row.version}`,
    );

    if (connected.ok) await reportMigrations(prisma);
  } finally {
    await prisma.$disconnect();
  }

  const direct = process.env.DATABASE_URL_UNPOOLED;
  if (!direct) {
    warn(
      'database: direct connection',
      'DATABASE_URL_UNPOOLED is not set; prisma migrate deploy will fail.',
    );
    return;
  }

  const directClient = new PrismaClient({ datasourceUrl: direct });
  try {
    await step(
      `database: connect over DATABASE_URL_UNPOOLED (${hostKind('DATABASE_URL_UNPOOLED')})`,
      async () => {
        const [row] = await directClient.$queryRaw<
          { database: string }[]
        >`SELECT current_database() AS database`;
        return row;
      },
      (row) => `database "${row.database}"`,
    );
  } finally {
    await directClient.$disconnect();
  }
}

/**
 * Informational. A database nobody has migrated yet is a fact worth seeing,
 * not a broken environment: the API container applies migrations at start.
 */
async function reportMigrations(prisma: PrismaClient): Promise<void> {
  const local = countLocalMigrations();

  const [{ exists }] = await prisma.$queryRaw<
    { exists: boolean }[]
  >`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS exists`.catch(
    () => [{ exists: false }],
  );
  if (!exists) {
    warn(
      'database: migrations',
      `no _prisma_migrations table yet (0 of ${local} applied). ` +
        'The API container runs prisma migrate deploy when it starts.',
    );
    return;
  }

  await step(
    'database: migrations table readable',
    async () => {
      const [row] = await prisma.$queryRaw<
        { applied: number; failed: number }[]
      >`SELECT
          count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::int AS applied,
          count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::int AS failed
        FROM _prisma_migrations`;
      return row;
    },
    (row) => `${row.applied} applied of ${local} in prisma/migrations`,
  ).then((result) => {
    if (!result.ok) return;
    const { applied, failed } = result.value;
    if (failed > 0) {
      fail(
        'database: migrations',
        new Error(
          `${failed} migration(s) started but never finished. ` +
            'prisma migrate deploy will refuse to run until this is resolved.',
        ),
      );
    } else if (applied < local) {
      warn(
        'database: migrations',
        `${local - applied} pending. Deploy the API (or run prisma migrate deploy) to apply them.`,
      );
    }
  });
}

function countLocalMigrations(): number {
  try {
    return readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    ).length;
  } catch {
    return 0;
  }
}

// ─── Storage ────────────────────────────────────────────────────────────────

async function checkStorage(): Promise<void> {
  say('\nStorage');

  let storage: StorageService;
  try {
    const config = readStorageConfig(process.env);
    if (!config.enabled) {
      throw new Error(
        'not configured: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION are all unset.',
      );
    }
    pass(
      'storage: configuration',
      `bucket "${config.bucket}", region ${config.region}, ` +
        (config.endpoint
          ? 'custom S3 endpoint (path-style)'
          : 'AWS S3 (virtual-host style)'),
    );
    storage = new StorageService(config);
  } catch (err) {
    fail('storage: configuration', err);
    return;
  }

  const key = `smoke/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.txt`;
  const body = `studio-rags storage smoke test\n${randomUUID()}\n`;
  let putAttempted = false;
  let putSucceeded = false;
  let deleted = false;

  try {
    await step('storage: bucket reachable (HeadBucket)', () =>
      storage.ping(FETCH_TIMEOUT_MS),
    );

    putAttempted = true;
    const put = await step(
      'storage: put',
      () => storage.put(key, body, 'text/plain; charset=utf-8', 'no-store'),
      () => key,
    );
    putSucceeded = put.ok;
    if (!put.ok) return;

    await step('storage: exists after put', async () => {
      const found = await storage.exists(key);
      if (!found) throw new Error('exists() returned false.');
    });

    await step(
      'storage: presigned GET with plain fetch',
      async () => {
        const url = await storage.presignGet(key, 120);
        const res = await fetch(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        const text = await res.text();
        if (!res.ok)
          throw new Error(`HTTP ${res.status} from the presigned URL.`);
        if (text !== body) throw new Error('body differs from what was put.');
        return res.status;
      },
      (status) => `HTTP ${status}, body matches`,
    );

    await step(
      'storage: get',
      async () => {
        const bytes = await storage.get(key);
        if (bytes.toString('utf8') !== body) {
          throw new Error('body differs from what was put.');
        }
        return bytes.length;
      },
      (length) => `${length} bytes, body matches`,
    );

    const del = await step('storage: delete', () => storage.delete(key));
    deleted = del.ok;

    await step('storage: exists after delete', async () => {
      const found = await storage.exists(key);
      if (found) throw new Error('exists() still returns true.');
    });
  } finally {
    // Second chance for the cleanup, so a failed step mid-way never leaves a
    // stray object in a real bucket.
    if (putAttempted && !deleted) {
      try {
        await storage.delete(key);
        say(`      cleanup: deleted ${key}`);
      } catch (err) {
        // After a failed put there is most likely nothing to delete, and the
        // put's own FAIL already explains why.
        if (putSucceeded) fail(`storage: cleanup of ${key}`, err);
        else warn(`storage: cleanup of ${key}`, describeError(err));
      }
    }
    storage.onModuleDestroy();
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  say('Studio Rags deployment smoke test');
  say(`NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`);

  await checkDatabase();
  await checkStorage();

  say(
    failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err: unknown) => {
  fail('smoke test aborted', err);
  process.exitCode = 1;
});
