import { BookingStatus, SessionStatus, WorkshopStatus } from '@prisma/client';
import type {
  SessionView,
  WorkshopCard,
  WorkshopDetail,
} from '../../src/catalogue/catalogue.types';
import {
  ZOOM_URL,
  createBooking,
  createSession,
  createWorkshop,
  inMinutes,
} from '../utils/catalogue';
import { useTestApp } from '../utils/test-app';

const API = '/api/v1';

describe('catalogue: /workshops', () => {
  const ctx = useTestApp();

  describe('GET /workshops', () => {
    it('lists published classes only, in the admin order, without signing in', async () => {
      const t = ctx();
      await createWorkshop(t, { slug: 'second', sortOrder: 2 });
      await createWorkshop(t, { slug: 'first', sortOrder: 1 });
      await createWorkshop(t, {
        slug: 'draft',
        status: WorkshopStatus.DRAFT,
        sortOrder: 0,
      });
      await createWorkshop(t, {
        slug: 'archived',
        status: WorkshopStatus.ARCHIVED,
      });

      const res = await t.http().get(`${API}/workshops`).expect(200);
      const { workshops } = res.body as { workshops: WorkshopCard[] };

      expect(workshops.map((w) => w.slug)).toEqual(['first', 'second']);
    });

    it('gives each card its hero image and price in cents', async () => {
      const t = ctx();
      const w = await createWorkshop(t, { basePriceCents: 6500 });
      await t.prisma.workshopImage.createMany({
        data: [
          { workshopId: w.id, url: '/a.jpg', alt: 'First', position: 0 },
          {
            workshopId: w.id,
            url: '/hero.jpg',
            alt: 'The hero',
            position: 1,
            isHero: true,
            width: 940,
            height: 470,
          },
        ],
      });

      const res = await t.http().get(`${API}/workshops`).expect(200);
      const [card] = (res.body as { workshops: WorkshopCard[] }).workshops;

      expect(card.priceCents).toBe(6500);
      expect(card.heroImage).toEqual({
        url: '/hero.jpg',
        alt: 'The hero',
        width: 940,
        height: 470,
      });
    });

    it('points nextSession at the soonest date that still has a seat', async () => {
      const t = ctx();
      const w = await createWorkshop(t);
      await createSession(t, w.id, -1); // already started
      const cancelled = await createSession(t, w.id, 2, {
        status: SessionStatus.CANCELLED,
      });
      const full = await createSession(t, w.id, 3, { capacity: 2 });
      await createBooking(t, full.id, 2, BookingStatus.CONFIRMED);
      const open = await createSession(t, w.id, 5);
      await createSession(t, w.id, 9);

      const res = await t.http().get(`${API}/workshops`).expect(200);
      const [card] = (res.body as { workshops: WorkshopCard[] }).workshops;

      expect(card.nextSession).toEqual({
        id: open.id,
        startsAt: open.startsAt.toISOString(),
        seatsLeft: 8,
      });
      expect(card.nextSession?.id).not.toBe(cancelled.id);
    });

    it('has no nextSession when nothing is on sale', async () => {
      const t = ctx();
      await createWorkshop(t);

      const res = await t.http().get(`${API}/workshops`).expect(200);

      expect(
        (res.body as { workshops: WorkshopCard[] }).workshops[0].nextSession,
      ).toBeNull();
    });
  });

  describe('GET /workshops/:slug', () => {
    it('returns the class with its gallery and the default cancellation terms', async () => {
      const t = ctx();
      await t.prisma.refundPolicy.create({
        data: { name: 'Standard', isDefault: true },
      });
      const w = await createWorkshop(t, {
        slug: 'kids',
        minAge: 7,
        maxAge: 15,
        requiresAccompanyingAdult: true,
      });
      await t.prisma.workshopImage.createMany({
        data: [
          { workshopId: w.id, url: '/2.jpg', alt: 'Second', position: 1 },
          { workshopId: w.id, url: '/1.jpg', alt: 'First', position: 0 },
        ],
      });

      const res = await t.http().get(`${API}/workshops/kids`).expect(200);
      const { workshop } = res.body as { workshop: WorkshopDetail };

      expect(workshop).toMatchObject({
        slug: 'kids',
        description: w.description,
        minAge: 7,
        maxAge: 15,
        requiresAccompanyingAdult: true,
        cancellation: {
          cutoffBusinessDays: 14,
          lateFeeCentsPerPerson: 1500,
          voucherValidityMonths: 6,
        },
      });
      expect(workshop.images.map((i) => i.url)).toEqual(['/1.jpg', '/2.jpg']);
      // No image is flagged as hero, so the first in the gallery stands in.
      expect(workshop.heroImage?.url).toBe('/1.jpg');
    });

    it('prefers the class’s own refund policy over the default', async () => {
      const t = ctx();
      await t.prisma.refundPolicy.create({
        data: { name: 'Standard', isDefault: true },
      });
      const own = await t.prisma.refundPolicy.create({
        data: { name: 'Online', cutoffBusinessDays: 5 },
      });
      await createWorkshop(t, { slug: 'online', refundPolicyId: own.id });

      const res = await t.http().get(`${API}/workshops/online`).expect(200);

      expect(
        (res.body as { workshop: WorkshopDetail }).workshop.cancellation
          ?.cutoffBusinessDays,
      ).toBe(5);
    });

    it.each([
      ['a draft', WorkshopStatus.DRAFT],
      ['an archived class', WorkshopStatus.ARCHIVED],
    ])(
      'answers 404 for %s, exactly as for a missing one',
      async (_, status) => {
        const t = ctx();
        await createWorkshop(t, { slug: 'hidden', status });

        const hidden = await t
          .http()
          .get(`${API}/workshops/hidden`)
          .expect(404);
        const missing = await t.http().get(`${API}/workshops/nope`).expect(404);

        expect(hidden.body).toEqual(missing.body);
      },
    );
  });

  describe('GET /workshops/:slug/sessions', () => {
    it('lists upcoming dates only, soonest first, with sold-out ones flagged', async () => {
      const t = ctx();
      const w = await createWorkshop(t, { slug: 'batik' });
      await createSession(t, w.id, -2);
      await createSession(t, w.id, 4, { status: SessionStatus.CANCELLED });
      await createSession(t, w.id, 6, { status: SessionStatus.COMPLETED });
      const later = await createSession(t, w.id, 10);
      const soldOut = await createSession(t, w.id, 3, { capacity: 1 });
      await createBooking(t, soldOut.id, 1, BookingStatus.CONFIRMED);

      const res = await t
        .http()
        .get(`${API}/workshops/batik/sessions`)
        .expect(200);
      const { sessions } = res.body as { sessions: SessionView[] };

      expect(sessions.map((s) => [s.id, s.seatsLeft, s.isFull])).toEqual([
        [soldOut.id, 0, true],
        [later.id, 8, false],
      ]);
    });

    it('counts confirmed bookings and live holds, and frees expired holds', async () => {
      const t = ctx();
      const w = await createWorkshop(t, { slug: 'shibori' });
      const s = await createSession(t, w.id, 7, { capacity: 8 });
      await createBooking(t, s.id, 2, BookingStatus.CONFIRMED);
      await createBooking(t, s.id, 1, BookingStatus.PENDING, inMinutes(10));
      // Not yet swept to EXPIRED, but its hold has run out.
      await createBooking(t, s.id, 3, BookingStatus.PENDING, inMinutes(-1));
      await createBooking(t, s.id, 4, BookingStatus.CANCELLED);
      await createBooking(t, s.id, 4, BookingStatus.EXPIRED);
      await createBooking(t, s.id, 4, BookingStatus.REFUNDED);

      const res = await t
        .http()
        .get(`${API}/workshops/shibori/sessions`)
        .expect(200);

      expect(
        (res.body as { sessions: SessionView[] }).sessions[0],
      ).toMatchObject({
        capacity: 8,
        seatsLeft: 5,
        isFull: false,
      });
    });

    it('never shows a negative count when capacity is lowered below what is booked', async () => {
      const t = ctx();
      const w = await createWorkshop(t, { slug: 'woodblock' });
      const s = await createSession(t, w.id, 7, { capacity: 6 });
      await createBooking(t, s.id, 5, BookingStatus.CONFIRMED);
      await t.prisma.session.update({
        where: { id: s.id },
        data: { capacity: 3 },
      });

      const res = await t
        .http()
        .get(`${API}/workshops/woodblock/sessions`)
        .expect(200);

      expect(
        (res.body as { sessions: SessionView[] }).sessions[0],
      ).toMatchObject({
        seatsLeft: 0,
        isFull: true,
      });
    });

    it('uses a session’s own price when it has one', async () => {
      const t = ctx();
      const w = await createWorkshop(t, {
        slug: 'priced',
        basePriceCents: 8200,
      });
      await createSession(t, w.id, 3);
      await createSession(t, w.id, 5, { priceCentsOverride: 9500 });

      const res = await t
        .http()
        .get(`${API}/workshops/priced/sessions`)
        .expect(200);

      expect(
        (res.body as { sessions: SessionView[] }).sessions.map(
          (s) => s.priceCents,
        ),
      ).toEqual([8200, 9500]);
    });

    it('answers 404 for the dates of an unpublished class', async () => {
      const t = ctx();
      const w = await createWorkshop(t, {
        slug: 'draft',
        status: WorkshopStatus.DRAFT,
      });
      await createSession(t, w.id, 3);

      await t.http().get(`${API}/workshops/draft/sessions`).expect(404);
    });
  });

  it('never puts the Zoom link in any public response', async () => {
    const t = ctx();
    const w = await createWorkshop(t, { slug: 'zoom' });
    await createSession(t, w.id, 3, {
      onlineJoinUrl: ZOOM_URL,
      location: null,
    });

    const bodies = await Promise.all(
      [
        `${API}/workshops`,
        `${API}/workshops/zoom`,
        `${API}/workshops/zoom/sessions`,
        `${API}/sessions`,
      ].map(async (path) => JSON.stringify((await t.http().get(path)).body)),
    );

    for (const body of bodies) {
      expect(body).not.toContain('zoom.us');
      expect(body).not.toContain('onlineJoinUrl');
    }
  });
});
