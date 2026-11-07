import { BookingStatus, SessionStatus, WorkshopStatus } from '@prisma/client';
import type {
  AvailabilityView,
  CalendarSessionView,
} from '../../src/catalogue/catalogue.types';
import type { ErrorBody } from '../utils/auth';
import {
  DAY_MS,
  createBooking,
  createSession,
  createWorkshop,
  inMinutes,
} from '../utils/catalogue';
import { useTestApp } from '../utils/test-app';

const API = '/api/v1';
const isoIn = (days: number) =>
  new Date(Date.now() + days * DAY_MS).toISOString();

describe('catalogue: /sessions', () => {
  const ctx = useTestApp();

  describe('GET /sessions', () => {
    it('returns every published class’s dates in [from, to), with the class attached', async () => {
      const t = ctx();
      const batik = await createWorkshop(t, { slug: 'batik', title: 'Batik' });
      const shibori = await createWorkshop(t, { slug: 'shibori' });
      const draft = await createWorkshop(t, { status: WorkshopStatus.DRAFT });
      const a = await createSession(t, batik.id, 3);
      const b = await createSession(t, shibori.id, 5);
      await createSession(t, batik.id, 20); // after `to`
      await createSession(t, draft.id, 4);

      const res = await t
        .http()
        .get(`${API}/sessions`)
        .query({ from: isoIn(1), to: isoIn(10) })
        .expect(200);
      const { sessions } = res.body as { sessions: CalendarSessionView[] };

      expect(sessions.map((s) => s.id)).toEqual([a.id, b.id]);
      expect(sessions[0].workshop).toEqual({
        slug: 'batik',
        title: 'Batik',
        productType: 'ONE_OFF',
        deliveryMode: 'IN_PERSON',
      });
    });

    it('never returns a session that has already started, even inside the range', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      await createSession(t, w.id, -1);
      const upcoming = await createSession(t, w.id, 1);

      const res = await t
        .http()
        .get(`${API}/sessions`)
        .query({ from: isoIn(-5), to: isoIn(5) })
        .expect(200);

      expect(
        (res.body as { sessions: CalendarSessionView[] }).sessions.map(
          (s) => s.id,
        ),
      ).toEqual([upcoming.id]);
    });

    it('defaults to the next 31 days and echoes the window it used', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const soon = await createSession(t, w.id, 30);
      await createSession(t, w.id, 32);

      const res = await t.http().get(`${API}/sessions`).expect(200);
      const body = res.body as {
        from: string;
        to: string;
        sessions: CalendarSessionView[];
      };

      expect(body.sessions.map((s) => s.id)).toEqual([soon.id]);
      expect(Date.parse(body.to) - Date.parse(body.from)).toBe(31 * DAY_MS);
    });

    it.each([
      [
        'an end before the start',
        { from: isoIn(5), to: isoIn(1) },
        'to must be later than from',
      ],
      [
        'more than 92 days',
        { from: isoIn(0), to: isoIn(93) },
        'A range can cover at most 92 days',
      ],
    ])('refuses %s', async (_, query, message) => {
      const res = await ctx()
        .http()
        .get(`${API}/sessions`)
        .query(query)
        .expect(400);

      expect((res.body as ErrorBody).message).toBe(message);
    });

    it('refuses a date that is not ISO 8601', async () => {
      const res = await ctx()
        .http()
        .get(`${API}/sessions`)
        .query({ from: 'next tuesday' })
        .expect(400);

      expect((res.body as ErrorBody).message).toEqual([
        'from must be an ISO 8601 date',
      ]);
    });

    it('refuses query parameters it does not know', async () => {
      await ctx()
        .http()
        .get(`${API}/sessions`)
        .query({ includeDrafts: 'true' })
        .expect(400);
    });
  });

  describe('GET /sessions/:id/availability', () => {
    it('gives the live count and tells every cache not to keep it', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 4, { capacity: 6 });
      await createBooking(t, s.id, 2, BookingStatus.CONFIRMED);
      await createBooking(t, s.id, 1, BookingStatus.PENDING, inMinutes(5));

      const res = await t
        .http()
        .get(`${API}/sessions/${s.id}/availability`)
        .expect(200);

      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body as AvailabilityView).toMatchObject({
        sessionId: s.id,
        status: 'SCHEDULED',
        capacity: 6,
        seatsLeft: 3,
        isFull: false,
        onSale: true,
      });
    });

    it('goes up again the moment a hold expires', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 4, { capacity: 2 });
      const hold = await createBooking(
        t,
        s.id,
        2,
        BookingStatus.PENDING,
        inMinutes(5),
      );
      const before = await t.http().get(`${API}/sessions/${s.id}/availability`);
      expect((before.body as AvailabilityView).isFull).toBe(true);

      await t.prisma.booking.update({
        where: { id: hold.id },
        data: { holdExpiresAt: inMinutes(-1) },
      });
      const after = await t.http().get(`${API}/sessions/${s.id}/availability`);

      expect((after.body as AvailabilityView).seatsLeft).toBe(2);
    });

    it('still answers for a cancelled session, as not on sale', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      const s = await createSession(t, w.id, 4, {
        status: SessionStatus.CANCELLED,
      });

      const res = await t
        .http()
        .get(`${API}/sessions/${s.id}/availability`)
        .expect(200);

      expect(res.body as AvailabilityView).toMatchObject({
        status: 'CANCELLED',
        onSale: false,
      });
    });

    it('answers 404 for an unknown session and for one of an unpublished class', async () => {
      const t = ctx();
      const draft = await createWorkshop(t, { status: WorkshopStatus.DRAFT });
      const hidden = await createSession(t, draft.id, 4);

      await t.http().get(`${API}/sessions/nope/availability`).expect(404);
      await t
        .http()
        .get(`${API}/sessions/${hidden.id}/availability`)
        .expect(404);
    });
  });
});
