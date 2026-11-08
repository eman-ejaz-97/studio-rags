import {
  BookingStatus,
  DeliveryMode,
  EmailStatus,
  ProductType,
  SessionStatus,
} from '@prisma/client';
import { HoldExpiryTask } from '../../src/bookings/hold-expiry.task';
import type { BookingView } from '../../src/bookings/bookings.types';
import { CSRF_PROBLEM_TYPE } from '../../src/common/csrf';
import { MAIL_TRANSPORT } from '../../src/mail/mail.transport';
import { MailService } from '../../src/mail/mail.service';
import { MemoryMailTransport } from '../../src/mail/transports/memory.transport';
import {
  BOOKINGS,
  bookingBody,
  bookingRow,
  getBooking,
  hold,
  lapse,
  postBooking,
  postConfirm,
  seatsLeftOn,
  signedInCustomer,
} from '../utils/bookings';
import type { ProblemBody } from '../utils/bookings';
import {
  DAY_MS,
  ZOOM_URL,
  createSession,
  createWorkshop,
} from '../utils/catalogue';
import type { TestApp } from '../utils/test-app';
import { useTestApp } from '../utils/test-app';

const PROBLEM_JSON = /^application\/problem\+json/;

/** A customer's live hold on a fresh session. */
async function heldBooking(t: TestApp, capacity = 4, seats = 1) {
  const w = await createWorkshop(t, { title: 'Batik' });
  const s = await createSession(t, w.id, 7, { capacity });
  const customer = await signedInCustomer(t, 'Ada');
  const booking = await hold(t, customer, bookingBody(s.id, { seats }));
  return { workshop: w, session: s, customer, booking };
}

const bookingOf = (body: unknown) => (body as { booking: BookingView }).booking;

/**
 * The interim step while Stripe is on hold: PAYMENT_MODE=none, as .env.test
 * and staging set it. The rules about seats are confirmBooking's, already
 * proven in payment-seam.e2e-spec.ts; these prove the route around them.
 */
describe('bookings: POST /bookings/:reference/confirm (PAYMENT_MODE=none)', () => {
  const ctx = useTestApp();

  const outbox = () => ctx().app.get<MemoryMailTransport>(MAIL_TRANSPORT);
  const mail = () => ctx().app.get(MailService);

  beforeEach(() => {
    outbox().clear();
  });

  it('runs with PAYMENT_MODE=none, as staging does', () => {
    expect(ctx().config.get('PAYMENT_MODE')).toBe('none');
  });

  describe('confirming', () => {
    it('confirms the caller’s own hold: 200 with the booking as GET returns it, and its places stay taken', async () => {
      const t = ctx();
      const { session, customer, booking } = await heldBooking(t, 4, 2);
      await expect(seatsLeftOn(t, session.id)).resolves.toBe(2);

      const res = await postConfirm(t, customer, booking.reference).expect(200);

      expect(res.headers['content-type']).toMatch(/^application\/json/);
      expect(res.headers['cache-control']).toBe('private, no-store');
      const confirmed = bookingOf(res.body);
      expect(confirmed).toMatchObject({
        reference: booking.reference,
        status: 'CONFIRMED',
        seats: 2,
        totalCents: booking.totalCents,
        holdExpiresAt: null,
        cancelledAt: null,
      });
      expect(Date.parse(confirmed.confirmedAt ?? '')).not.toBeNaN();

      const fetched = await getBooking(t, customer, booking.reference).expect(
        200,
      );
      expect(bookingOf(fetched.body)).toEqual(confirmed);
      await expect(seatsLeftOn(t, session.id)).resolves.toBe(2);
      await expect(bookingRow(t, booking.reference)).resolves.toMatchObject({
        status: BookingStatus.CONFIRMED,
        userId: customer.id,
      });
    });

    it('emails the customer, recorded in email_logs against the booking', async () => {
      const t = ctx();
      const { customer, booking } = await heldBooking(t);
      const row = await bookingRow(t, booking.reference);

      await postConfirm(t, customer, booking.reference).expect(200);
      await mail().whenIdle();

      const logs = await t.prisma.emailLog.findMany();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        to: customer.email,
        template: 'booking-confirmation',
        bookingId: row.id,
        status: EmailStatus.SENT,
        error: null,
      });
      expect(logs[0].subject).toMatch(/^You're booked in: Batik, /);

      expect(outbox().sent).toHaveLength(1);
      const [email] = outbox().sent;
      expect(email).toMatchObject({
        emailLogId: logs[0].id,
        to: customer.email,
      });
      expect(email.text).toContain('Hi Ada,');
      expect(email.text).toContain(booking.reference);
    });

    it('answers a second confirm with the same booking, and sends no second email', async () => {
      const t = ctx();
      const { customer, booking } = await heldBooking(t);

      const first = await postConfirm(t, customer, booking.reference).expect(
        200,
      );
      const again = await postConfirm(t, customer, booking.reference).expect(
        200,
      );
      await mail().whenIdle();

      // confirmedAt included: the repeat changed nothing.
      expect(again.body).toEqual(first.body);
      await expect(t.prisma.emailLog.count()).resolves.toBe(1);
      expect(outbox().sent).toHaveLength(1);
    });

    it('sends one email when two confirms arrive at the same moment (a double-tap)', async () => {
      const t = ctx();
      const { customer, booking } = await heldBooking(t);

      const answers = await Promise.all([
        postConfirm(t, customer, booking.reference),
        postConfirm(t, customer, booking.reference),
      ]);
      await mail().whenIdle();

      expect(answers.map((res) => res.status)).toEqual([200, 200]);
      expect(answers[0].body).toEqual(answers[1].body);
      await expect(t.prisma.emailLog.count()).resolves.toBe(1);
    });

    it('accepts the reference typed in lower case, as GET does', async () => {
      const t = ctx();
      const { customer, booking } = await heldBooking(t);

      const res = await postConfirm(
        t,
        customer,
        booking.reference.toLowerCase(),
      ).expect(200);

      expect(bookingOf(res.body).reference).toBe(booking.reference);
    });

    it('releases the Zoom link once confirmed, in the answer and in the email (ADR-015)', async () => {
      const t = ctx();
      const w = await createWorkshop(t, {
        productType: ProductType.ONLINE,
        deliveryMode: DeliveryMode.ONLINE,
      });
      const s = await createSession(t, w.id, 7, {
        location: null,
        onlineJoinUrl: ZOOM_URL,
      });
      const ada = await signedInCustomer(t);
      const booking = await hold(t, ada, bookingBody(s.id));
      expect(booking.session.onlineJoinUrl).toBeNull();

      const res = await postConfirm(t, ada, booking.reference).expect(200);
      await mail().whenIdle();

      expect(bookingOf(res.body).session.onlineJoinUrl).toBe(ZOOM_URL);
      expect(outbox().sent[0].html).toContain('https://zoom.us/j/1234567890');
    });

    it('confirms a free class, total 0, like any other (§ 10 item 39)', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7, { priceCentsOverride: 0 });
      const ada = await signedInCustomer(t);
      const booking = await hold(t, ada, bookingBody(s.id));
      expect(booking.totalCents).toBe(0);

      const res = await postConfirm(t, ada, booking.reference).expect(200);
      await mail().whenIdle();

      expect(bookingOf(res.body)).toMatchObject({
        status: 'CONFIRMED',
        totalCents: 0,
      });
      await expect(t.prisma.emailLog.count()).resolves.toBe(1);
    });

    it('keeps counting a confirmed booking as taken after its hold time has passed, sweep or no sweep', async () => {
      const t = ctx();
      const { session, customer, booking } = await heldBooking(t, 2, 2);
      await postConfirm(t, customer, booking.reference).expect(200);

      // The hold time on the row is now in the past; a CONFIRMED booking
      // ignores it.
      await lapse(t, booking.reference);
      await expect(seatsLeftOn(t, session.id)).resolves.toBe(0);
      await t.app.get(HoldExpiryTask).run();

      await expect(bookingRow(t, booking.reference)).resolves.toMatchObject({
        status: BookingStatus.CONFIRMED,
      });
      await expect(seatsLeftOn(t, session.id)).resolves.toBe(0);
      const late = await postBooking(
        t,
        await signedInCustomer(t),
        bookingBody(session.id),
      ).expect(409);
      expect((late.body as ProblemBody).type).toBe('/problems/session-full');
    });
  });

  describe('a hold that ran out (§ 10 item 33)', () => {
    it.each([
      ['before the sweep has reached it', false],
      ['after the sweep marked it EXPIRED', true],
    ])(
      'is confirmed late while its places are still free, %s',
      async (_, swept) => {
        const t = ctx();
        const { session, customer, booking } = await heldBooking(t, 4, 2);
        await lapse(t, booking.reference);
        if (swept) await t.app.get(HoldExpiryTask).run();
        await expect(seatsLeftOn(t, session.id)).resolves.toBe(4);

        const res = await postConfirm(t, customer, booking.reference).expect(
          200,
        );
        await mail().whenIdle();

        expect(bookingOf(res.body).status).toBe('CONFIRMED');
        await expect(seatsLeftOn(t, session.id)).resolves.toBe(2);
        await expect(t.prisma.emailLog.count()).resolves.toBe(1);
      },
    );

    it('is refused with hold-lapsed once its places have gone to someone else, and the session is never overbooked', async () => {
      const t = ctx();
      const { session, customer, booking } = await heldBooking(t, 2, 2);
      await lapse(t, booking.reference);
      await hold(t, await signedInCustomer(t), bookingBody(session.id));

      const res = await postConfirm(t, customer, booking.reference).expect(409);
      await mail().whenIdle();

      expect(res.headers['content-type']).toMatch(PROBLEM_JSON);
      const detail =
        'Your hold ran out and those places have been taken. Please choose a date again.';
      expect(res.body).toEqual({
        type: '/problems/hold-lapsed',
        title: 'Your hold has run out',
        status: 409,
        detail,
        statusCode: 409,
        message: detail,
      });
      await expect(bookingRow(t, booking.reference)).resolves.toMatchObject({
        status: BookingStatus.PENDING,
        confirmedAt: null,
      });
      await expect(seatsLeftOn(t, session.id)).resolves.toBe(1);
      await expect(t.prisma.emailLog.count()).resolves.toBe(0);
    });
  });

  describe('refusals', () => {
    it('refuses a hold replaced by a newer one with booking-cancelled; the newer one confirms', async () => {
      const t = ctx();
      const { session, customer, booking } = await heldBooking(t);
      const newer = await hold(
        t,
        customer,
        bookingBody(session.id, { seats: 2 }),
      );

      const res = await postConfirm(t, customer, booking.reference).expect(409);

      expect(res.headers['content-type']).toMatch(PROBLEM_JSON);
      const detail =
        'This booking was cancelled, or replaced when the places were changed, so it cannot be confirmed. Please check your bookings.';
      expect(res.body).toEqual({
        type: '/problems/booking-cancelled',
        title: 'This booking is no longer active',
        status: 409,
        detail,
        statusCode: 409,
        message: detail,
      });
      await postConfirm(t, customer, newer.reference).expect(200);
      await mail().whenIdle();
      const logs = await t.prisma.emailLog.findMany();
      expect(logs.map((l) => l.bookingId)).toEqual([
        (await bookingRow(t, newer.reference)).id,
      ]);
    });

    it.each([
      [
        SessionStatus.CANCELLED,
        'cancelled',
        'This class date has been cancelled.',
      ],
      [
        SessionStatus.COMPLETED,
        'completed',
        'This class date has already taken place.',
      ],
    ])(
      'refuses a booking on a session that is %s as not on sale, saying why',
      async (status, reason, detail) => {
        const t = ctx();
        const { session, customer, booking } = await heldBooking(t);
        await t.prisma.session.update({
          where: { id: session.id },
          data: { status },
        });

        const res = await postConfirm(t, customer, booking.reference).expect(
          409,
        );

        expect(res.headers['content-type']).toMatch(PROBLEM_JSON);
        expect(res.body).toEqual({
          type: '/problems/session-not-on-sale',
          title: 'This date cannot be booked',
          status: 409,
          detail,
          reason,
          statusCode: 409,
          message: detail,
        });
        await expect(bookingRow(t, booking.reference)).resolves.toMatchObject({
          status: BookingStatus.PENDING,
        });
      },
    );

    it('refuses a hold on a class that has since started', async () => {
      const t = ctx();
      const { session, customer, booking } = await heldBooking(t);
      const startsAt = new Date(Date.now() - 60_000);
      await t.prisma.session.update({
        where: { id: session.id },
        data: { startsAt, endsAt: new Date(startsAt.getTime() + DAY_MS / 8) },
      });

      const res = await postConfirm(t, customer, booking.reference).expect(409);

      expect(res.body as ProblemBody).toMatchObject({
        type: '/problems/session-not-on-sale',
        reason: 'started',
      });
      await expect(t.prisma.emailLog.count()).resolves.toBe(0);
    });
  });

  describe('who may confirm', () => {
    it('answers another customer’s reference exactly as GET does, and leaves that booking alone', async () => {
      const t = ctx();
      const { customer: ada, booking } = await heldBooking(t);
      const bea = await signedInCustomer(t);

      const theirs = await postConfirm(t, bea, booking.reference).expect(404);
      const missing = await postConfirm(t, bea, 'SR-ZZZZZ').expect(404);
      const malformed = await postConfirm(t, bea, 'not-a-reference').expect(
        404,
      );
      const viaGet = await getBooking(t, bea, booking.reference).expect(404);

      for (const res of [missing, malformed, viaGet]) {
        expect(res.body).toEqual(theirs.body);
      }
      await expect(bookingRow(t, booking.reference)).resolves.toMatchObject({
        status: BookingStatus.PENDING,
        userId: ada.id,
      });
      await expect(t.prisma.emailLog.count()).resolves.toBe(0);
    });

    it('needs a signed-in customer', async () => {
      const t = ctx();
      const { booking } = await heldBooking(t);

      await t
        .http()
        .post(`${BOOKINGS}/${booking.reference}/confirm`)
        .expect(401);
      await expect(bookingRow(t, booking.reference)).resolves.toMatchObject({
        status: BookingStatus.PENDING,
      });
    });

    it('refuses a request with no CSRF token (ADR-044), before confirming anything', async () => {
      const t = ctx();
      const { customer, booking } = await heldBooking(t);

      const res = await t
        .httpWithoutCsrf()
        .post(`${BOOKINGS}/${booking.reference}/confirm`)
        .set('Cookie', customer.cookie)
        .expect(403);

      expect(res.get('Content-Type')).toMatch(PROBLEM_JSON);
      expect(JSON.parse(res.text)).toMatchObject({
        type: CSRF_PROBLEM_TYPE,
        status: 403,
      });
      await expect(bookingRow(t, booking.reference)).resolves.toMatchObject({
        status: BookingStatus.PENDING,
      });
    });

    it('limits a visitor to 10 confirm attempts a minute', async () => {
      const t = ctx();
      const ada = await signedInCustomer(t);

      for (let i = 1; i <= 10; i++) {
        await postConfirm(t, ada, 'SR-ZZZZZ').expect(404);
      }
      await postConfirm(t, ada, 'SR-ZZZZZ').expect(429);
    });
  });
});
