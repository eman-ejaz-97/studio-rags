import { BookingStatus, Prisma, PrismaClient } from '@prisma/client';
import { seatHoldingBookings } from '../../src/catalogue/availability';
import { isCapacityRefusal } from '../../src/bookings/booking-errors';
import { seatsLeftOn } from '../utils/bookings';
import {
  createBooking,
  createSession,
  createWorkshop,
  inMinutes,
} from '../utils/catalogue';
import { slowBookingInserts } from '../utils/slow-session-inserts';
import type { TestApp } from '../utils/test-app';
import { useTestApp } from '../utils/test-app';
import { assertTestDatabaseUrl } from '../utils/test-db-guard';

/**
 * FR-A5 step 6. Every write here goes straight to the table, past the booking
 * service and its lock, as a future admin tool or a hand-written script
 * might. Only the database's own trigger stands between them and an
 * overbooked session.
 */

let refs = 0;
const nextRef = () => `SR-X${(refs += 1).toString().padStart(4, '0')}`;

async function customerId(t: TestApp) {
  const user = await t.prisma.user.create({
    data: {
      email: `direct-${nextRef()}@example.com`,
      passwordHash: 'not-a-real-hash',
      firstName: 'Direct',
      lastName: 'Writer',
    },
  });
  return user.id;
}

/** A booking row written directly, with no lock and no count. */
async function insertBooking(
  db: Prisma.TransactionClient,
  data: {
    sessionId: string;
    userId: string;
    seats: number;
    status: BookingStatus;
    holdExpiresAt?: Date | null;
  },
) {
  return db.booking.create({
    data: {
      reference: nextRef(),
      subtotalCents: 8200 * data.seats,
      totalCents: 8200 * data.seats,
      ...data,
    },
  });
}

/** True when the write was refused by the capacity trigger, false if it went through. */
function refusedByTrigger(write: Promise<unknown>): Promise<boolean> {
  return write.then(
    () => false,
    (error: unknown) => isCapacityRefusal(error),
  );
}

async function seatsInTable(t: TestApp, sessionId: string, now = new Date()) {
  const { _sum } = await t.prisma.booking.aggregate({
    where: { sessionId, ...seatHoldingBookings(now) },
    _sum: { seats: true },
  });
  return _sum.seats ?? 0;
}

async function fullSession(t: TestApp, capacity = 2) {
  const w = await createWorkshop(t);
  const s = await createSession(t, w.id, 7, { capacity });
  await createBooking(t, s.id, capacity, BookingStatus.CONFIRMED);
  return s;
}

describe('the capacity trigger (FR-A5 step 6)', () => {
  const ctx = useTestApp();

  it('refuses a booking written straight into a full session, and names itself', async () => {
    const t = ctx();
    const s = await fullSession(t);
    const userId = await customerId(t);

    const error: unknown = await insertBooking(t.prisma, {
      sessionId: s.id,
      userId,
      seats: 1,
      status: BookingStatus.CONFIRMED,
    }).catch((e: unknown) => e);

    expect(isCapacityRefusal(error)).toBe(true);
    expect((error as Error).message).toContain(
      `bookings_session_capacity: session ${s.id} would be overbooked, 3 seats taken of 2`,
    );
    await expect(t.prisma.booking.count()).resolves.toBe(1);
  });

  it('refuses the same write in raw SQL, with SQLSTATE 23514 (check_violation)', async () => {
    const t = ctx();
    const s = await fullSession(t);
    const userId = await customerId(t);

    const error: unknown = await t.prisma.$executeRaw`
      INSERT INTO bookings (id, reference, "sessionId", "userId", seats, status,
                            "subtotalCents", "totalCents", "holdExpiresAt", "updatedAt")
      VALUES ('raw-insert', ${nextRef()}, ${s.id}, ${userId}, 1, 'PENDING',
              8200, 8200, now() + interval '15 minutes', now())
    `.catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((error as Prisma.PrismaClientKnownRequestError).meta).toMatchObject({
      code: '23514',
    });
    expect(isCapacityRefusal(error)).toBe(true);
  });

  it.each([
    ['a cancelled booking', BookingStatus.CANCELLED, null],
    ['an expired hold', BookingStatus.EXPIRED, null],
    ['a hold that has already run out', BookingStatus.PENDING, inMinutes(-1)],
  ])(
    'lets %s into a full session, since it takes no place',
    async (_, status, holdExpiresAt) => {
      const t = ctx();
      const s = await fullSession(t);

      await insertBooking(t.prisma, {
        sessionId: s.id,
        userId: await customerId(t),
        seats: 3,
        status,
        holdExpiresAt,
      });

      await expect(t.prisma.booking.count()).resolves.toBe(2);
    },
  );

  describe('refuses an update that adds places to a full session', () => {
    it('more places on a confirmed booking', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7, { capacity: 3 });
      const b = await createBooking(t, s.id, 3, BookingStatus.CONFIRMED);

      await expect(
        refusedByTrigger(
          t.prisma.booking.update({ where: { id: b.id }, data: { seats: 4 } }),
        ),
      ).resolves.toBe(true);
    });

    it('reviving a hold that ran out after its places were taken', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7, { capacity: 2 });
      const lapsed = await createBooking(
        t,
        s.id,
        1,
        BookingStatus.PENDING,
        inMinutes(-1),
      );
      await createBooking(t, s.id, 2, BookingStatus.CONFIRMED);

      await expect(
        refusedByTrigger(
          t.prisma.booking.update({
            where: { id: lapsed.id },
            data: { holdExpiresAt: inMinutes(15) },
          }),
        ),
      ).resolves.toBe(true);
      await expect(
        refusedByTrigger(
          t.prisma.booking.update({
            where: { id: lapsed.id },
            data: { status: BookingStatus.CONFIRMED },
          }),
        ),
      ).resolves.toBe(true);
    });

    it('confirming an expired hold', async () => {
      const t = ctx();
      const s = await fullSession(t);
      const expired = await createBooking(t, s.id, 1, BookingStatus.EXPIRED);

      await expect(
        refusedByTrigger(
          t.prisma.booking.update({
            where: { id: expired.id },
            data: { status: BookingStatus.CONFIRMED },
          }),
        ),
      ).resolves.toBe(true);
    });

    it('moving a booking onto a full session', async () => {
      const t = ctx();
      const full = await fullSession(t);
      const w = await createWorkshop(t);
      const other = await createSession(t, w.id, 9);
      const b = await createBooking(t, other.id, 1, BookingStatus.CONFIRMED);

      await expect(
        refusedByTrigger(
          t.prisma.booking.update({
            where: { id: b.id },
            data: { sessionId: full.id },
          }),
        ),
      ).resolves.toBe(true);
    });
  });

  it('allows releasing places, and confirming a live hold, on a session already over capacity', async () => {
    // The admin may lower capacity below what is booked (ADR-012). Existing
    // bookings stand; only writes that add places are refused.
    const t = ctx();
    const w = await createWorkshop(t);
    const s = await createSession(t, w.id, 7, { capacity: 5 });
    const paid = await createBooking(t, s.id, 2, BookingStatus.CONFIRMED);
    const live = await createBooking(
      t,
      s.id,
      2,
      BookingStatus.PENDING,
      inMinutes(10),
    );
    const other = await createBooking(
      t,
      s.id,
      1,
      BookingStatus.PENDING,
      inMinutes(10),
    );
    await t.prisma.session.update({
      where: { id: s.id },
      data: { capacity: 1 },
    });

    await t.prisma.booking.update({
      where: { id: live.id },
      data: { status: BookingStatus.CONFIRMED },
    });
    await t.prisma.booking.update({
      where: { id: paid.id },
      data: { status: BookingStatus.CANCELLED },
    });
    await t.prisma.booking.update({
      where: { id: other.id },
      data: { status: BookingStatus.EXPIRED },
    });

    await expect(seatsInTable(t, s.id)).resolves.toBe(2);
  });

  it('agrees with the booking service and the catalogue on what holds a place', async () => {
    const t = ctx();
    const w = await createWorkshop(t);
    const s = await createSession(t, w.id, 7, { capacity: 8 });
    await createBooking(t, s.id, 2, BookingStatus.CONFIRMED);
    await createBooking(t, s.id, 1, BookingStatus.PENDING, inMinutes(10));
    await createBooking(t, s.id, 3, BookingStatus.PENDING, inMinutes(-1));
    await createBooking(t, s.id, 4, BookingStatus.CANCELLED);
    await createBooking(t, s.id, 4, BookingStatus.EXPIRED);
    await createBooking(t, s.id, 4, BookingStatus.REFUNDED);
    const userId = await customerId(t);

    await expect(seatsLeftOn(t, s.id)).resolves.toBe(5);
    // Exactly the five the catalogue reports fit, and not one more.
    await insertBooking(t.prisma, {
      sessionId: s.id,
      userId,
      seats: 5,
      status: BookingStatus.CONFIRMED,
    });
    await expect(
      refusedByTrigger(
        insertBooking(t.prisma, {
          sessionId: s.id,
          userId,
          seats: 1,
          status: BookingStatus.CONFIRMED,
        }),
      ),
    ).resolves.toBe(true);
    await expect(seatsLeftOn(t, s.id)).resolves.toBe(0);
  });

  it('stops writers that skip the lock from overbooking, even when they all count before any of them writes', async () => {
    const t = ctx();
    const w = await createWorkshop(t);
    const s = await createSession(t, w.id, 7, { capacity: 3 });
    const writers = 8;
    const userIds = await Promise.all(
      Array.from({ length: writers }, () => customerId(t)),
    );

    // A client of its own with a connection per writer, so all eight are
    // genuinely inside the database at once whatever the machine's core count.
    const url = new URL(process.env.DATABASE_URL ?? '');
    assertTestDatabaseUrl(url.toString());
    url.searchParams.set('connection_limit', String(writers + 2));
    const direct = new PrismaClient({
      datasources: { db: { url: url.toString() } },
    });
    // Inserts wait 150 ms, so every writer has counted before any commits:
    // the classic "count, then insert" race, with nothing but the trigger
    // to stop it.
    const restore = await slowBookingInserts(t.prisma, 150);

    let outcomes: PromiseSettledResult<'inserted' | 'refused by own count'>[];
    try {
      outcomes = await Promise.allSettled(
        userIds.map((userId) =>
          direct.$transaction(async (tx) => {
            const { _sum } = await tx.booking.aggregate({
              where: { sessionId: s.id, ...seatHoldingBookings(new Date()) },
              _sum: { seats: true },
            });
            if ((_sum.seats ?? 0) + 1 > 3) return 'refused by own count';
            await insertBooking(tx, {
              sessionId: s.id,
              userId,
              seats: 1,
              status: BookingStatus.PENDING,
              holdExpiresAt: inMinutes(15),
            });
            return 'inserted';
          }),
        ),
      );
    } finally {
      await restore();
      await direct.$disconnect();
    }

    const inserted = outcomes.filter(
      (o) => o.status === 'fulfilled' && o.value === 'inserted',
    ).length;
    const stoppedByTrigger = outcomes.filter(
      (o) => o.status === 'rejected' && isCapacityRefusal(o.reason),
    ).length;
    const stoppedByOwnCount = outcomes.filter(
      (o) => o.status === 'fulfilled' && o.value === 'refused by own count',
    ).length;

    expect(inserted).toBe(3);
    // Every other writer was refused by the trigger or its own count, none by
    // a deadlock or a timeout. The first version of the trigger locked the
    // session FOR UPDATE, which fights the KEY SHARE lock each insert's
    // foreign-key check holds: this test then saw 3 inserted, 2 refused and
    // 3 transactions deadlocked into their 5 s timeout.
    expect(inserted + stoppedByTrigger + stoppedByOwnCount).toBe(writers);
    // Their own counts let more than three through; the trigger stopped the rest.
    expect(inserted + stoppedByTrigger).toBeGreaterThan(3);
    await expect(seatsInTable(t, s.id)).resolves.toBe(3);
  });
});
