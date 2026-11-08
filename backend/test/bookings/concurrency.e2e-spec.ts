// Must stay the first imports: they set API_PROXY_SECRET and a wider
// connection pool before AppModule is imported and its environment read.
import { TEST_PROXY_SECRET } from '../auth/support/proxy-secret';
import './support/wide-pool';
import { Logger } from '@nestjs/common';
import { BookingStatus, PrismaClient } from '@prisma/client';
import {
  CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
} from '../../src/common/client-address';
import {
  bookingBody,
  postBooking,
  seatsLeftOn,
  signedInCustomer,
} from '../utils/bookings';
import type { ProblemBody } from '../utils/bookings';
import { createSession, createWorkshop } from '../utils/catalogue';
import { slowBookingInserts, sleep } from '../utils/slow-session-inserts';
import type { TestApp } from '../utils/test-app';
import { useTestApp } from '../utils/test-app';
import { assertTestDatabaseUrl } from '../utils/test-db-guard';

/**
 * Each customer arrives as their own visitor through the website's proxy,
 * as they would on the real site, so the per-visitor booking limit applies
 * to each one separately rather than to all fifty at once.
 */
const visitor = (i: number) => ({
  [CLIENT_IP_HEADER]: `198.51.100.${i + 1}`,
  [PROXY_SECRET_HEADER]: TEST_PROXY_SECRET,
});

/**
 * Watches Postgres from a connection of its own while a burst runs, and keeps
 * the most backends it saw waiting on a lock at once: evidence that the
 * requests really were in the database together, queued on the session row,
 * and not handled one after another.
 */
function watchLockWaits() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assertTestDatabaseUrl(url.toString());
  url.searchParams.set('connection_limit', '1');
  const watcher = new PrismaClient({
    datasources: { db: { url: url.toString() } },
  });
  let peak = 0;
  let running = true;
  const loop = (async () => {
    while (running) {
      const [{ waiting }] = await watcher.$queryRaw<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      peak = Math.max(peak, waiting);
      await sleep(5);
    }
  })();
  return async () => {
    running = false;
    await loop;
    await watcher.$disconnect();
    return peak;
  };
}

async function heldSeats(t: TestApp, sessionId: string) {
  const rows = await t.prisma.booking.findMany({
    where: { sessionId },
    select: { userId: true, seats: true, status: true },
  });
  return {
    rows: rows.length,
    seats: rows.reduce((sum, r) => sum + r.seats, 0),
    customers: new Set(rows.map((r) => r.userId)).size,
    statuses: [...new Set(rows.map((r) => r.status))],
  };
}

describe('bookings under concurrency (FR-A5, SPEC § 5)', () => {
  const ctx = useTestApp();

  it('50 customers booking one place each on a 10-place session at the same moment get exactly 10 holds', async () => {
    const t = ctx();
    const w = await createWorkshop(t);
    const s = await createSession(t, w.id, 7, { capacity: 10 });
    const customers = await Promise.all(
      Array.from({ length: 50 }, () => signedInCustomer(t)),
    );
    // The service logs an error if the database trigger ever has to refuse
    // what the service's own locked count let through.
    const errors = jest.spyOn(Logger.prototype, 'error');
    // Each insert holds the lock a little longer, so the queue is certain.
    const restore = await slowBookingInserts(t.prisma, 20);
    const stopWatching = watchLockWaits();

    let results;
    try {
      results = await Promise.all(
        customers.map((c, i) =>
          postBooking(t, c, bookingBody(s.id), visitor(i)),
        ),
      );
    } finally {
      await restore();
    }
    const peakLockWaits = await stopWatching();

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((code) => code === 201)).toHaveLength(10);
    expect(statuses.filter((code) => code === 409)).toHaveLength(40);
    for (const refused of results.filter((r) => r.status === 409)) {
      expect(refused.body as ProblemBody).toMatchObject({
        type: '/problems/session-full',
        seatsLeft: 0,
      });
    }
    await expect(heldSeats(t, s.id)).resolves.toEqual({
      rows: 10,
      seats: 10,
      customers: 10,
      statuses: [BookingStatus.PENDING],
    });
    await expect(seatsLeftOn(t, s.id)).resolves.toBe(0);
    expect(errors).not.toHaveBeenCalled();
    expect(peakLockWaits).toBeGreaterThanOrEqual(2);
  });

  it('never goes over capacity when 30 customers ask for one to three places at once', async () => {
    const t = ctx();
    const w = await createWorkshop(t);
    const s = await createSession(t, w.id, 7, { capacity: 10 });
    const customers = await Promise.all(
      Array.from({ length: 30 }, () => signedInCustomer(t)),
    );
    const asked = customers.map((_, i) => (i % 3) + 1);

    const results = await Promise.all(
      customers.map((c, i) =>
        postBooking(t, c, bookingBody(s.id, { seats: asked[i] }), visitor(i)),
      ),
    );

    const granted = results.reduce(
      (sum, r, i) => sum + (r.status === 201 ? asked[i] : 0),
      0,
    );
    expect(results.every((r) => r.status === 201 || r.status === 409)).toBe(
      true,
    );
    expect(granted).toBeLessThanOrEqual(10);
    // Every refusal was honest: it asked for more than it was told was left.
    results.forEach((r, i) => {
      if (r.status === 409) {
        expect((r.body as ProblemBody).seatsLeft).toBeLessThan(asked[i]);
      }
    });
    await expect(heldSeats(t, s.id)).resolves.toMatchObject({
      seats: granted,
    });
    await expect(seatsLeftOn(t, s.id)).resolves.toBe(10 - granted);
  });

  it('bookings on different sessions do not wait for each other’s locks', async () => {
    const t = ctx();
    const w = await createWorkshop(t);
    const sessions = await Promise.all(
      Array.from({ length: 5 }, () =>
        createSession(t, w.id, 7, { capacity: 1 }),
      ),
    );
    const customers = await Promise.all(
      sessions.map(() => signedInCustomer(t)),
    );
    const restore = await slowBookingInserts(t.prisma, 300);

    let elapsed: number;
    try {
      const started = Date.now();
      const results = await Promise.all(
        sessions.map((s, i) =>
          postBooking(t, customers[i], bookingBody(s.id), visitor(i)),
        ),
      );
      elapsed = Date.now() - started;
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    } finally {
      await restore();
    }

    // Queued one behind another, five 300 ms inserts would take 1.5 s.
    expect(elapsed).toBeLessThan(1_200);
  });
});
