import type { PrismaService } from '../../src/prisma/prisma.service';
import { assertTestDatabaseUrl } from './test-db-guard';

/**
 * Makes every INSERT into refresh_tokens wait `ms` before it happens, so a
 * test can send a second request while the first is part-way through writing
 * a session. Real latency to a hosted database opens the same window; this
 * just makes it wide and repeatable instead of a matter of luck.
 *
 * Returns the function that removes it again; call it in a finally. The
 * database checks its own name inside the same statement, as resetDatabase
 * does, so the trigger can never be added anywhere but a "_test" database.
 */
export function slowSessionInserts(
  prisma: PrismaService,
  ms: number,
): Promise<() => Promise<void>> {
  return slowRowWrites(prisma, {
    name: 'e2e_slow_session_insert',
    table: 'refresh_tokens',
    event: 'INSERT',
    ms,
  });
}

/**
 * Makes every UPDATE of a password_reset_tokens row wait `ms`, holding that
 * row's lock while it waits: a BEFORE trigger runs after Postgres has locked
 * the row. Two resets started together then both hold their own link at the
 * same moment, every time, which is the overlap that deadlocks if the two
 * ever take their locks in opposite orders. Same guard and same clean-up as
 * slowSessionInserts.
 */
export function slowResetLinkUpdates(
  prisma: PrismaService,
  ms: number,
): Promise<() => Promise<void>> {
  return slowRowWrites(prisma, {
    name: 'e2e_slow_reset_link_update',
    table: 'password_reset_tokens',
    event: 'UPDATE',
    ms,
  });
}

/**
 * Makes every INSERT into bookings wait `ms` first. Each booking transaction
 * then holds the session lock for that long, so concurrent attempts are sure
 * to be queued on it at the same time; and a writer that skips the lock has
 * time to count before anyone else commits, which is the race the capacity
 * trigger must catch. Same guard and same clean-up as slowSessionInserts.
 */
export function slowBookingInserts(
  prisma: PrismaService,
  ms: number,
): Promise<() => Promise<void>> {
  return slowRowWrites(prisma, {
    name: 'e2e_slow_booking_insert',
    table: 'bookings',
    event: 'INSERT',
    ms,
  });
}

interface SlowRowWrites {
  /** The trigger and its function share this name. */
  name: string;
  table: 'refresh_tokens' | 'password_reset_tokens' | 'bookings';
  event: 'INSERT' | 'UPDATE';
  ms: number;
}

async function slowRowWrites(
  prisma: PrismaService,
  { name, table, event, ms }: SlowRowWrites,
): Promise<() => Promise<void>> {
  assertTestDatabaseUrl(process.env.DATABASE_URL);
  if (!Number.isInteger(ms) || ms <= 0 || ms > 5_000) {
    throw new RangeError(`A slow-write trigger takes 1 to 5000 ms, got ${ms}`);
  }

  // Interpolated rather than bound: DDL takes no parameters. The value was
  // checked to be a small integer above, and the names come from the fixed
  // callers in this file, never from a test.
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF right(current_database(), 5) <> '_test' THEN
        RAISE EXCEPTION 'Refusing to add a test trigger to non-test database %', current_database();
      END IF;
      CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger
        LANGUAGE plpgsql AS $fn$
        BEGIN
          PERFORM pg_sleep(${ms / 1000});
          RETURN NEW;
        END
        $fn$;
      DROP TRIGGER IF EXISTS ${name} ON "${table}";
      CREATE TRIGGER ${name} BEFORE ${event} ON "${table}"
        FOR EACH ROW EXECUTE FUNCTION ${name}();
    END
    $$;
  `);

  return async () => {
    await prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS ${name} ON "${table}"`,
    );
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
  };
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
