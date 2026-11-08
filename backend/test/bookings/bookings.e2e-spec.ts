import {
  BookingStatus,
  DeliveryMode,
  ProductType,
  SessionStatus,
  WorkshopStatus,
} from '@prisma/client';
import { REFERENCE_PATTERN } from '../../src/bookings/booking-reference';
import { BookingsService } from '../../src/bookings/bookings.service';
import type { BookingView } from '../../src/bookings/bookings.types';
import type { ErrorBody } from '../utils/auth';
import {
  BOOKINGS,
  bookingBody,
  bookingRow,
  bookingsService,
  getBooking,
  hold,
  lapse,
  postBooking,
  seatsLeftOn,
  signedInCustomer,
} from '../utils/bookings';
import type { ProblemBody } from '../utils/bookings';
import {
  ZOOM_URL,
  createBooking,
  createSession,
  createWorkshop,
} from '../utils/catalogue';
import { useTestApp } from '../utils/test-app';

const MINUTE_MS = 60_000;

describe('bookings: POST /bookings and GET /bookings/:reference', () => {
  const ctx = useTestApp();

  describe('POST /bookings', () => {
    it('needs a signed-in customer', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7);

      await t.http().post(BOOKINGS).send(bookingBody(s.id)).expect(401);
      await expect(t.prisma.booking.count()).resolves.toBe(0);
    });

    it('holds the places for 15 minutes at the session’s price, and the catalogue counts them at once', async () => {
      const t = ctx();
      const w = await createWorkshop(t, {
        slug: 'batik',
        title: 'Batik',
        basePriceCents: 8200,
      });
      const s = await createSession(t, w.id, 7, {
        capacity: 6,
        priceCentsOverride: 9500,
      });
      const ada = await signedInCustomer(t);
      const before = Date.now();

      const res = await postBooking(
        t,
        ada,
        bookingBody(s.id, { seats: 2 }),
      ).expect(201);
      const { booking } = res.body as { booking: BookingView };

      expect(booking).toMatchObject({
        status: 'PENDING',
        seats: 2,
        subtotalCents: 19000,
        discountCents: 0,
        totalCents: 19000,
        photoConsentOptOut: false,
        notes: null,
        attendees: [],
        confirmedAt: null,
        cancelledAt: null,
        session: {
          id: s.id,
          onlineJoinUrl: null,
          workshop: { slug: 'batik', title: 'Batik', productType: 'ONE_OFF' },
        },
      });
      expect(booking.reference).toMatch(REFERENCE_PATTERN);
      const holdMs = Date.parse(booking.holdExpiresAt ?? '') - before;
      expect(holdMs).toBeGreaterThan(15 * MINUTE_MS - 5_000);
      expect(holdMs).toBeLessThanOrEqual(15 * MINUTE_MS + 5_000);

      await expect(seatsLeftOn(t, s.id)).resolves.toBe(4);
      await expect(bookingRow(t, booking.reference)).resolves.toMatchObject({
        userId: ada.id,
        status: BookingStatus.PENDING,
      });
    });

    it('uses the class price when the session has none of its own', async () => {
      const t = ctx();
      const w = await createWorkshop(t, { basePriceCents: 6500 });
      const s = await createSession(t, w.id, 7);

      const booking = await hold(
        t,
        await signedInCustomer(t),
        bookingBody(s.id, { seats: 3 }),
      );

      expect(booking.totalCents).toBe(19500);
    });

    it('keeps the price it was booked at when the price changes afterwards (ADR-012)', async () => {
      const t = ctx();
      const w = await createWorkshop(t, { basePriceCents: 8200 });
      const s = await createSession(t, w.id, 7);
      const ada = await signedInCustomer(t);
      const booking = await hold(t, ada, bookingBody(s.id));

      await t.prisma.session.update({
        where: { id: s.id },
        data: { priceCentsOverride: 12000 },
      });
      await t.prisma.workshop.update({
        where: { id: w.id },
        data: { basePriceCents: 11000 },
      });

      const res = await getBooking(t, ada, booking.reference).expect(200);
      expect((res.body as { booking: BookingView }).booking).toMatchObject({
        subtotalCents: 8200,
        totalCents: 8200,
      });
    });

    it('stores the photography opt-out and the notes, trimmed (ADR-018)', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7);

      const booking = await hold(
        t,
        await signedInCustomer(t),
        bookingBody(s.id, {
          photoConsentOptOut: true,
          notes: '  I am left-handed  ',
        }),
      );

      expect(booking).toMatchObject({
        photoConsentOptOut: true,
        notes: 'I am left-handed',
      });
      await expect(bookingRow(t, booking.reference)).resolves.toMatchObject({
        photoConsentOptOut: true,
        attendeeNotes: 'I am left-handed',
      });
    });

    it('refuses more places than are left with a 409 problem that says how many remain', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7, { capacity: 3 });
      await createBooking(t, s.id, 2, BookingStatus.CONFIRMED);
      const ada = await signedInCustomer(t);

      const res = await postBooking(
        t,
        ada,
        bookingBody(s.id, { seats: 2 }),
      ).expect(409);

      expect(res.headers['content-type']).toMatch(
        /^application\/problem\+json/,
      );
      expect(res.body).toEqual({
        type: '/problems/session-full',
        title: 'Not enough places left',
        status: 409,
        detail: 'Only 1 place is left in this class.',
        seatsLeft: 1,
        statusCode: 409,
        message: 'Only 1 place is left in this class.',
      });
      await expect(
        t.prisma.booking.count({ where: { userId: ada.id } }),
      ).resolves.toBe(0);
    });

    it('says a class with no places left is fully booked', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7, { capacity: 2 });
      await createBooking(t, s.id, 2, BookingStatus.CONFIRMED);

      const res = await postBooking(
        t,
        await signedInCustomer(t),
        bookingBody(s.id),
      ).expect(409);

      expect(res.body as ProblemBody).toMatchObject({
        seatsLeft: 0,
        detail: 'This class is fully booked.',
      });
    });

    it.each([
      [
        'cancelled',
        { status: SessionStatus.CANCELLED },
        7,
        'This class date has been cancelled.',
      ],
      [
        'completed',
        { status: SessionStatus.COMPLETED },
        7,
        'This class date has already taken place.',
      ],
      [
        'started',
        {},
        -0.01,
        'This class date has already started, so it can no longer be booked.',
      ],
    ])(
      'refuses a session that is %s as not on sale',
      async (reason, overrides, daysAhead, detail) => {
        const t = ctx();
        const w = await createWorkshop(t);
        const s = await createSession(t, w.id, daysAhead, overrides);

        const res = await postBooking(
          t,
          await signedInCustomer(t),
          bookingBody(s.id),
        ).expect(409);

        expect(res.headers['content-type']).toMatch(
          /^application\/problem\+json/,
        );
        expect(res.body as ProblemBody).toMatchObject({
          type: '/problems/session-not-on-sale',
          status: 409,
          detail,
          reason,
        });
        await expect(t.prisma.booking.count()).resolves.toBe(0);
      },
    );

    it('answers 404 for an unknown session, and for a session of a class that is not published', async () => {
      const t = ctx();
      const draft = await createWorkshop(t, { status: WorkshopStatus.DRAFT });
      const s = await createSession(t, draft.id, 7);
      const ada = await signedInCustomer(t);

      for (const sessionId of [s.id, 'no-such-session']) {
        const res = await postBooking(t, ada, bookingBody(sessionId)).expect(
          404,
        );
        expect((res.body as ErrorBody).message).toBe('Session not found');
      }
    });

    it.each([
      ['no places', { seats: 0 }, 'Book at least one place'],
      [
        'more than one booking can take',
        { seats: 9 },
        'One booking can take up to 8 places. For a bigger group, send us a message.',
      ],
      ['places as text', { seats: '2' }, 'Choose how many places to book'],
      [
        'no answer to the photography question',
        { photoConsentOptOut: undefined },
        'Tell us whether you would rather not appear in photos or video',
      ],
      [
        'over-long notes',
        { notes: 'x'.repeat(501) },
        'Keep notes to 500 characters',
      ],
      [
        'a field it does not know',
        { paid: true },
        'property paid should not exist',
      ],
    ])('refuses %s with a 400 in words', async (_, overrides, message) => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7);

      const res = await postBooking(
        t,
        await signedInCustomer(t),
        bookingBody(s.id, overrides),
      ).expect(400);

      expect((res.body as ErrorBody).message).toContain(message);
    });

    it('limits a visitor to 10 booking attempts a minute', async () => {
      const t = ctx();
      const ada = await signedInCustomer(t);

      for (let i = 1; i <= 10; i++) {
        await postBooking(t, ada, {}).expect(400);
      }
      await postBooking(t, ada, {}).expect(429);
    });
  });

  describe('one live hold per customer per session', () => {
    it('answers the same request again with the same hold, unchanged (a double-click)', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7);
      const ada = await signedInCustomer(t);
      const body = bookingBody(s.id, { seats: 2, notes: 'Two of us' });
      const first = await hold(t, ada, body);

      const res = await postBooking(t, ada, body).expect(200);

      expect((res.body as { booking: BookingView }).booking).toEqual(first);
      await expect(t.prisma.booking.count()).resolves.toBe(1);
      await expect(seatsLeftOn(t, s.id)).resolves.toBe(6);
    });

    it('replaces the hold when the request changes, and the old one stops holding places', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7, { capacity: 8 });
      const ada = await signedInCustomer(t);
      const first = await hold(t, ada, bookingBody(s.id, { seats: 2 }));

      const second = await hold(t, ada, bookingBody(s.id, { seats: 3 }));

      expect(second.reference).not.toBe(first.reference);
      await expect(seatsLeftOn(t, s.id)).resolves.toBe(5);
      const old = await getBooking(t, ada, first.reference).expect(200);
      expect((old.body as { booking: BookingView }).booking).toMatchObject({
        status: 'CANCELLED',
        holdExpiresAt: null,
      });
      await expect(bookingRow(t, first.reference)).resolves.toMatchObject({
        cancellationReason: `Replaced by ${second.reference}`,
      });
    });

    it('counts the customer’s own hold towards a bigger request, and keeps it when the bigger one does not fit', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7, { capacity: 4 });
      await createBooking(t, s.id, 1, BookingStatus.CONFIRMED);
      const ada = await signedInCustomer(t);
      const first = await hold(t, ada, bookingBody(s.id, { seats: 2 }));

      const res = await postBooking(
        t,
        ada,
        bookingBody(s.id, { seats: 4 }),
      ).expect(409);

      expect(res.body as ProblemBody).toMatchObject({
        seatsLeft: 3,
        detail:
          'Only 3 places are left in this class, counting the 2 places you are already holding.',
      });
      await expect(bookingRow(t, first.reference)).resolves.toMatchObject({
        status: BookingStatus.PENDING,
        cancelledAt: null,
      });
      await expect(seatsLeftOn(t, s.id)).resolves.toBe(1);

      // Three fits: the old hold's two places plus the one nobody holds.
      const third = await hold(t, ada, bookingBody(s.id, { seats: 3 }));
      expect(third.seats).toBe(3);
      await expect(seatsLeftOn(t, s.id)).resolves.toBe(0);
    });

    it('lets two customers hold places on the same session', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7);

      await hold(t, await signedInCustomer(t), bookingBody(s.id));
      await hold(t, await signedInCustomer(t), bookingBody(s.id));

      await expect(seatsLeftOn(t, s.id)).resolves.toBe(6);
    });
  });

  it('draws a new reference when the first one is already taken', async () => {
    const t = ctx();
    const w = await createWorkshop(t);
    const s = await createSession(t, w.id, 7);
    const taken = await createBooking(t, s.id, 1, BookingStatus.CONFIRMED);
    await t.prisma.booking.update({
      where: { id: taken.id },
      data: { reference: 'SR-22222' },
    });
    const draw = jest
      .spyOn(t.app.get(BookingsService), 'newReference')
      .mockReturnValueOnce('SR-22222')
      .mockReturnValueOnce('SR-33333');

    const booking = await hold(t, await signedInCustomer(t), bookingBody(s.id));

    expect(booking.reference).toBe('SR-33333');
    expect(draw).toHaveBeenCalledTimes(2);
    await expect(t.prisma.booking.count()).resolves.toBe(2);
  });

  describe('the kids class (ADR-016, ADR-033)', () => {
    async function kidsSession() {
      const t = ctx();
      const w = await createWorkshop(t, {
        slug: 'kids-and-parents',
        productType: ProductType.KIDS,
        basePriceCents: 4200,
        minAge: 7,
        maxAge: 15,
        requiresAccompanyingAdult: true,
      });
      return createSession(t, w.id, 7, { capacity: 6 });
    }

    it('takes one child per place, ages within the range, one price per child', async () => {
      const t = ctx();
      const s = await kidsSession();
      const ada = await signedInCustomer(t);

      const booking = await hold(
        t,
        ada,
        bookingBody(s.id, {
          seats: 2,
          attendees: [
            { firstName: ' Sam ', age: 7 },
            { firstName: 'Noor', age: 15 },
          ],
        }),
      );

      expect(booking).toMatchObject({
        seats: 2,
        totalCents: 8400,
        attendees: [
          { firstName: 'Sam', age: 7 },
          { firstName: 'Noor', age: 15 },
        ],
        session: { workshop: { requiresAccompanyingAdult: true } },
      });
      // Capacity counts children: two of six taken, adults not counted.
      await expect(seatsLeftOn(t, s.id)).resolves.toBe(4);
    });

    it('refuses a child outside the age range, or without a name, saying so in words', async () => {
      const t = ctx();
      const s = await kidsSession();

      const res = await postBooking(
        t,
        await signedInCustomer(t),
        bookingBody(s.id, {
          seats: 2,
          attendees: [
            { firstName: 'Sam', age: 6 },
            { firstName: '  ', age: 16 },
          ],
        }),
      ).expect(400);

      expect((res.body as ErrorBody).message).toEqual([
        'Sam is 6. This class is for ages 7 to 15.',
        'Enter the first name of child 2.',
        'Child 2 is 16. This class is for ages 7 to 15.',
      ]);
      await expect(t.prisma.booking.count()).resolves.toBe(0);
    });

    it.each([
      [
        'fewer children than places',
        { seats: 2, attendees: [{ firstName: 'Sam', age: 8 }] },
        'Give a first name and age for each child: 2 places booked, 1 child listed.',
      ],
      [
        'no children at all',
        { seats: 1 },
        'Give a first name and age for each child: 1 place booked, 0 children listed.',
      ],
    ])('refuses %s', async (_, overrides, message) => {
      const t = ctx();
      const s = await kidsSession();

      const res = await postBooking(
        t,
        await signedInCustomer(t),
        bookingBody(s.id, overrides),
      ).expect(400);

      expect((res.body as ErrorBody).message).toEqual([message]);
    });

    it('refuses an age that is not a whole number', async () => {
      const t = ctx();
      const s = await kidsSession();

      const res = await postBooking(
        t,
        await signedInCustomer(t),
        bookingBody(s.id, { attendees: [{ firstName: 'Sam', age: 'seven' }] }),
      ).expect(400);

      expect((res.body as ErrorBody).message).toContain(
        'attendees.0.age must be an integer number',
      );
    });

    it('an adult class does not take attendee details', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7);

      const res = await postBooking(
        t,
        await signedInCustomer(t),
        bookingBody(s.id, { attendees: [{ firstName: 'Sam', age: 30 }] }),
      ).expect(400);

      expect((res.body as ErrorBody).message).toEqual([
        'This class does not take attendee details. Leave them out.',
      ]);
    });
  });

  describe('a hold that runs out (FR-A5 steps 3 and 5)', () => {
    it('frees its places the moment it runs out, before any sweep has run', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7, { capacity: 2 });
      const ada = await signedInCustomer(t);
      const bea = await signedInCustomer(t);
      const adas = await hold(t, ada, bookingBody(s.id, { seats: 2 }));
      await postBooking(t, bea, bookingBody(s.id)).expect(409);

      await lapse(t, adas.reference);

      const beas = await hold(t, bea, bookingBody(s.id));
      expect(beas.status).toBe('PENDING');
      await expect(seatsLeftOn(t, s.id)).resolves.toBe(1);
      // Ada sees her hold has ended, though the row still says PENDING.
      const res = await getBooking(t, ada, adas.reference).expect(200);
      expect((res.body as { booking: BookingView }).booking).toMatchObject({
        status: 'EXPIRED',
        holdExpiresAt: null,
      });
    });

    it('a customer whose own hold ran out can book again', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7, { capacity: 1 });
      const ada = await signedInCustomer(t);
      const first = await hold(t, ada, bookingBody(s.id));
      await lapse(t, first.reference);

      const second = await hold(t, ada, bookingBody(s.id));

      expect(second.reference).not.toBe(first.reference);
      // The lapsed hold is left for the sweep, not replaced.
      await expect(bookingRow(t, first.reference)).resolves.toMatchObject({
        status: BookingStatus.PENDING,
        cancelledAt: null,
      });
    });
  });

  describe('GET /bookings/:reference', () => {
    it('returns the caller’s own booking, never cached', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7);
      const ada = await signedInCustomer(t);
      const booking = await hold(t, ada, bookingBody(s.id));

      const res = await getBooking(t, ada, booking.reference).expect(200);

      expect((res.body as { booking: BookingView }).booking).toEqual(booking);
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('accepts a reference typed in lower case or with spaces', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7);
      const ada = await signedInCustomer(t);
      const booking = await hold(t, ada, bookingBody(s.id));

      await getBooking(t, ada, ` ${booking.reference.toLowerCase()} `).expect(
        200,
      );
    });

    it('answers another customer’s reference exactly as it answers one that does not exist', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 7);
      const ada = await signedInCustomer(t);
      const bea = await signedInCustomer(t);
      const adas = await hold(t, ada, bookingBody(s.id));

      const theirs = await getBooking(t, bea, adas.reference).expect(404);
      const missing = await getBooking(t, bea, 'SR-ZZZZZ').expect(404);
      const malformed = await getBooking(t, bea, 'not-a-reference').expect(404);

      expect(theirs.body).toEqual(missing.body);
      expect(theirs.body).toEqual(malformed.body);
      expect((theirs.body as ErrorBody).message).toBe('Booking not found');
    });

    it('needs a signed-in customer', async () => {
      await ctx().http().get(`${BOOKINGS}/SR-22222`).expect(401);
    });
  });

  describe('the Zoom link (ADR-015)', () => {
    it('is withheld from a hold and released once the booking is confirmed', async () => {
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

      const created = await postBooking(t, ada, bookingBody(s.id)).expect(201);
      const { booking } = created.body as { booking: BookingView };
      const fetched = await getBooking(t, ada, booking.reference).expect(200);
      const listed = await t
        .http()
        .get(BOOKINGS)
        .set('Cookie', ada.cookie)
        .expect(200);

      for (const res of [created, fetched, listed]) {
        expect(res.text).not.toContain(ZOOM_URL);
      }
      expect(booking.session.onlineJoinUrl).toBeNull();

      const row = await bookingRow(t, booking.reference);
      await bookingsService(t).confirmBooking(row.id);

      const confirmed = await getBooking(t, ada, booking.reference).expect(200);
      expect(
        (confirmed.body as { booking: BookingView }).booking.session
          .onlineJoinUrl,
      ).toBe(ZOOM_URL);
    });
  });
});
