import { BookingStatus } from '@prisma/client';
import type { ErrorBody } from '../utils/auth';
import {
  BOOKINGS,
  bookingBody,
  bookingRow,
  bookingsService,
  hold,
  lapse,
  listBookings,
  signedInCustomer,
} from '../utils/bookings';
import type { Customer } from '../utils/bookings';
import { createSession, createWorkshop } from '../utils/catalogue';
import type { TestApp } from '../utils/test-app';
import { useTestApp } from '../utils/test-app';

/** A confirmed booking written directly, at a chosen creation time. */
async function confirmedAt(
  t: TestApp,
  customer: Customer,
  sessionId: string,
  reference: string,
  createdAt: Date,
) {
  return t.prisma.booking.create({
    data: {
      reference,
      sessionId,
      userId: customer.id,
      seats: 1,
      status: BookingStatus.CONFIRMED,
      confirmedAt: createdAt,
      subtotalCents: 8200,
      totalCents: 8200,
      createdAt,
    },
  });
}

describe('bookings: GET /bookings', () => {
  const ctx = useTestApp();

  it('lists the caller’s bookings newest first, leaving out holds that ran out or were replaced', async () => {
    const t = ctx();
    const w = await createWorkshop(t);
    const [s1, s2, s3, s4] = await Promise.all(
      [3, 4, 5, 6].map((days) => createSession(t, w.id, days)),
    );
    const ada = await signedInCustomer(t);
    const bea = await signedInCustomer(t);

    const paid = await hold(t, ada, bookingBody(s1.id));
    await bookingsService(t).confirmBooking(
      (await bookingRow(t, paid.reference)).id,
    );
    const lapsed = await hold(t, ada, bookingBody(s2.id));
    await lapse(t, lapsed.reference);
    await hold(t, ada, bookingBody(s3.id)); // replaced by the next line
    const live = await hold(t, ada, bookingBody(s3.id, { seats: 2 }));
    await hold(t, bea, bookingBody(s4.id));

    const page = await listBookings(t, ada);

    expect(page.bookings.map((b) => [b.reference, b.status])).toEqual([
      [live.reference, 'PENDING'],
      [paid.reference, 'CONFIRMED'],
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('keeps a confirmed booking that was later cancelled in the history', async () => {
    const t = ctx();
    const w = await createWorkshop(t);
    const s = await createSession(t, w.id, 7);
    const ada = await signedInCustomer(t);
    const booking = await confirmedAt(t, ada, s.id, 'SR-44444', new Date());
    await t.prisma.booking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.CANCELLED, cancelledAt: new Date() },
    });

    const page = await listBookings(t, ada);

    expect(page.bookings.map((b) => [b.reference, b.status])).toEqual([
      ['SR-44444', 'CANCELLED'],
    ]);
  });

  it('pages with the cursor it hands out, with no booking missed or repeated', async () => {
    const t = ctx();
    const w = await createWorkshop(t);
    const s = await createSession(t, w.id, 7);
    const ada = await signedInCustomer(t);
    const base = Date.now() - 60_000;
    // Five bookings, two of them made in the same millisecond, so the id
    // has to break the tie between pages.
    const refs = ['SR-AAAAA', 'SR-BBBBB', 'SR-CCCCC', 'SR-DDDDD', 'SR-EEEEE'];
    const times = [0, 1_000, 2_000, 2_000, 3_000];
    for (const [i, reference] of refs.entries()) {
      await confirmedAt(t, ada, s.id, reference, new Date(base + times[i]));
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await listBookings(t, ada, {
        limit: 2,
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.bookings.map((b) => b.reference));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen[0]).toBe('SR-EEEEE');
    expect(seen[4]).toBe('SR-AAAAA');
  });

  it.each([
    [
      'a cursor it did not issue',
      { cursor: 'bm90LWEtY3Vyc29y' },
      'cursor is not valid',
    ],
    ['a page size of 0', { limit: 0 }, 'limit must be at least 1'],
    ['a page size over 50', { limit: 51 }, 'limit can be at most 50'],
    [
      'a page size that is not a number',
      { limit: 'ten' },
      'limit must be a whole number',
    ],
  ])('refuses %s', async (_, query, message) => {
    const t = ctx();
    const ada = await signedInCustomer(t);

    const res = await t
      .http()
      .get(BOOKINGS)
      .query(query)
      .set('Cookie', ada.cookie)
      .expect(400);

    expect([(res.body as ErrorBody).message].flat()).toContain(message);
  });

  it('is never cached, and needs a signed-in customer', async () => {
    const t = ctx();
    const ada = await signedInCustomer(t);

    const res = await t
      .http()
      .get(BOOKINGS)
      .set('Cookie', ada.cookie)
      .expect(200);

    expect(res.headers['cache-control']).toBe('private, no-store');
    await t.http().get(BOOKINGS).expect(401);
  });
});
