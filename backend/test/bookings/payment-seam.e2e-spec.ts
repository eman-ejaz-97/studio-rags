import { Logger } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BookingStatus, SessionStatus } from '@prisma/client';
import {
  HOLD_EXPIRY_JOB,
  HoldExpiryTask,
} from '../../src/bookings/hold-expiry.task';
import {
  bookingBody,
  bookingRow,
  bookingsService,
  hold,
  lapse,
  seatsLeftOn,
  signedInCustomer,
} from '../utils/bookings';
import {
  createBooking,
  createSession,
  createWorkshop,
  inMinutes,
} from '../utils/catalogue';
import type { TestApp } from '../utils/test-app';
import { useTestApp } from '../utils/test-app';

/** A customer's live hold on a fresh session, and the row behind it. */
async function heldBooking(t: TestApp, capacity = 4, seats = 1) {
  const w = await createWorkshop(t);
  const s = await createSession(t, w.id, 7, { capacity });
  const customer = await signedInCustomer(t);
  const view = await hold(t, customer, bookingBody(s.id, { seats }));
  const row = await bookingRow(t, view.reference);
  return { session: s, customer, view, row };
}

describe('bookings: the expiry sweep and the payment seam', () => {
  const ctx = useTestApp();

  describe('the expiry sweep (FR-A5 step 5)', () => {
    it('is scheduled to run every minute', () => {
      const job = ctx().app.get(SchedulerRegistry).getCronJob(HOLD_EXPIRY_JOB);

      expect(job.cronTime.source).toBe('*/1 * * * *');
      expect(job.isActive).toBe(true);
    });

    it('marks lapsed holds EXPIRED and leaves live holds and confirmed bookings alone', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7, { capacity: 8 });
      const lapsed = await createBooking(
        t,
        s.id,
        1,
        BookingStatus.PENDING,
        inMinutes(-1),
      );
      const timeless = await createBooking(t, s.id, 1, BookingStatus.PENDING);
      const live = await createBooking(
        t,
        s.id,
        1,
        BookingStatus.PENDING,
        inMinutes(5),
      );
      const paid = await createBooking(t, s.id, 1, BookingStatus.CONFIRMED);
      const before = await seatsLeftOn(t, s.id);

      await expect(t.app.get(HoldExpiryTask).run()).resolves.toBe(2);

      const statuses = await t.prisma.booking.findMany({
        select: { id: true, status: true },
      });
      expect(new Map(statuses.map((b) => [b.id, b.status]))).toEqual(
        new Map([
          [lapsed.id, BookingStatus.EXPIRED],
          [timeless.id, BookingStatus.EXPIRED],
          [live.id, BookingStatus.PENDING],
          [paid.id, BookingStatus.CONFIRMED],
        ]),
      );
      // Tidying only: the count was already right before the sweep ran.
      await expect(seatsLeftOn(t, s.id)).resolves.toBe(before);
      await expect(t.app.get(HoldExpiryTask).run()).resolves.toBe(0);
    });

    it('logs and swallows a failure, so the next tick simply tries again', async () => {
      const t = ctx();
      jest
        .spyOn(bookingsService(t), 'expireLapsedHolds')
        .mockRejectedValueOnce(new Error('database asleep'));
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);

      await expect(t.app.get(HoldExpiryTask).run()).resolves.toBe(0);
      expect(logged).toHaveBeenCalledWith(
        'Hold expiry sweep failed',
        expect.stringContaining('database asleep'),
      );
    });
  });

  describe('confirmBooking: PENDING to CONFIRMED, for the payment webhook', () => {
    it('confirms a live hold once, and answers a repeat as already confirmed', async () => {
      const t = ctx();
      const { row, view } = await heldBooking(t);

      await expect(bookingsService(t).confirmBooking(row.id)).resolves.toEqual({
        kind: 'confirmed',
        bookingId: row.id,
        reference: view.reference,
      });
      const confirmed = await bookingRow(t, view.reference);
      await expect(bookingsService(t).confirmBooking(row.id)).resolves.toEqual({
        kind: 'already-confirmed',
        bookingId: row.id,
        reference: view.reference,
      });

      expect(confirmed.status).toBe(BookingStatus.CONFIRMED);
      expect(confirmed.confirmedAt).not.toBeNull();
      // The repeat changed nothing, not even the timestamp.
      await expect(bookingRow(t, view.reference)).resolves.toEqual(confirmed);
    });

    it('confirms exactly once when the same event arrives twice at the same moment', async () => {
      const t = ctx();
      const { row } = await heldBooking(t);

      const outcomes = await Promise.all([
        bookingsService(t).confirmBooking(row.id),
        bookingsService(t).confirmBooking(row.id),
      ]);

      expect(outcomes.map((o) => o.kind).sort()).toEqual([
        'already-confirmed',
        'confirmed',
      ]);
    });

    it('confirms a live hold even after the admin lowered capacity below what is booked', async () => {
      const t = ctx();
      const { row, session } = await heldBooking(t, 4, 3);
      await t.prisma.session.update({
        where: { id: session.id },
        data: { capacity: 2 },
      });

      await expect(
        bookingsService(t).confirmBooking(row.id),
      ).resolves.toMatchObject({ kind: 'confirmed' });
    });

    it.each([
      ['a lapsed hold the sweep has not reached', false],
      ['a hold the sweep has marked EXPIRED', true],
    ])(
      'honours a late payment for %s while its places are still free',
      async (_, swept) => {
        const t = ctx();
        const { row, view } = await heldBooking(t);
        await lapse(t, view.reference);
        if (swept) await t.app.get(HoldExpiryTask).run();

        await expect(
          bookingsService(t).confirmBooking(row.id),
        ).resolves.toMatchObject({ kind: 'confirmed' });
        await expect(bookingRow(t, view.reference)).resolves.toMatchObject({
          status: BookingStatus.CONFIRMED,
        });
      },
    );

    it('refuses a late payment whose places have gone to someone else, so the session is never overbooked', async () => {
      const t = ctx();
      const { row, view, session } = await heldBooking(t, 2, 2);
      await lapse(t, view.reference);
      await hold(t, await signedInCustomer(t), bookingBody(session.id));

      await expect(bookingsService(t).confirmBooking(row.id)).resolves.toEqual({
        kind: 'refused',
        reason: 'no-seats',
        bookingId: row.id,
      });
      await expect(bookingRow(t, view.reference)).resolves.toMatchObject({
        status: BookingStatus.PENDING,
        confirmedAt: null,
      });
      await expect(seatsLeftOn(t, session.id)).resolves.toBe(1);
    });

    it('refuses a hold that was replaced by a newer one', async () => {
      const t = ctx();
      const { row, session, customer } = await heldBooking(t);
      await hold(t, customer, bookingBody(session.id, { seats: 2 }));

      await expect(
        bookingsService(t).confirmBooking(row.id),
      ).resolves.toMatchObject({ kind: 'refused', reason: 'cancelled' });
    });

    it('refuses a booking for a session the studio cancelled', async () => {
      const t = ctx();
      const { row, session } = await heldBooking(t);
      await t.prisma.session.update({
        where: { id: session.id },
        data: { status: SessionStatus.CANCELLED },
      });

      await expect(
        bookingsService(t).confirmBooking(row.id),
      ).resolves.toMatchObject({
        kind: 'refused',
        reason: 'session-unavailable',
      });
    });

    it('refuses an id it does not know', async () => {
      await expect(
        bookingsService(ctx()).confirmBooking('no-such-booking'),
      ).resolves.toEqual({
        kind: 'refused',
        reason: 'not-found',
        bookingId: 'no-such-booking',
      });
    });
  });

  describe('findPayableHold: what POST /payments/intent will charge', () => {
    it('returns the caller’s own live hold with the amount to charge', async () => {
      const t = ctx();
      const { customer, view, row, session } = await heldBooking(t, 4, 2);

      const payable = await bookingsService(t).findPayableHold(
        customer.id,
        view.reference.toLowerCase(),
      );

      expect(payable).toEqual({
        id: row.id,
        reference: view.reference,
        userId: customer.id,
        sessionId: session.id,
        seats: 2,
        totalCents: 16400,
        currency: 'aud',
        holdExpiresAt: row.holdExpiresAt,
      });
    });

    it('returns null for someone else’s hold, a lapsed one, a paid one and a made-up reference', async () => {
      const t = ctx();
      const service = bookingsService(t);
      const other = await signedInCustomer(t);
      const theirs = await heldBooking(t);
      const lapsed = await heldBooking(t);
      await lapse(t, lapsed.view.reference);
      const paid = await heldBooking(t);
      await service.confirmBooking(paid.row.id);

      await expect(
        service.findPayableHold(other.id, theirs.view.reference),
      ).resolves.toBeNull();
      await expect(
        service.findPayableHold(lapsed.customer.id, lapsed.view.reference),
      ).resolves.toBeNull();
      await expect(
        service.findPayableHold(paid.customer.id, paid.view.reference),
      ).resolves.toBeNull();
      await expect(
        service.findPayableHold(other.id, 'not-a-reference'),
      ).resolves.toBeNull();
    });
  });
});
