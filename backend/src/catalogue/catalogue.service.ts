import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SessionStatus, WorkshopStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  seatHoldingBookings,
  seatsLeft,
  sessionPriceCents,
} from './availability';
import type {
  AvailabilityView,
  CalendarSessionView,
  ImageView,
  SessionView,
  WorkshopCard,
  WorkshopDetail,
} from './catalogue.types';

/** Enough for a season of dates on one class page, never an unbounded list. */
export const WORKSHOP_SESSIONS_LIMIT = 24;

const imageSelect = {
  url: true,
  alt: true,
  width: true,
  height: true,
} satisfies Prisma.WorkshopImageSelect;

const cardSelect = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  productType: true,
  deliveryMode: true,
  durationMinutes: true,
  basePriceCents: true,
  minAge: true,
  maxAge: true,
  requiresAccompanyingAdult: true,
  images: {
    select: imageSelect,
    // The hero first, then the admin's order. One image is all a card needs.
    orderBy: [{ isHero: 'desc' }, { position: 'asc' }],
    take: 1,
  },
} satisfies Prisma.WorkshopSelect;

const cancellationSelect = {
  cutoffBusinessDays: true,
  lateFeeCentsPerPerson: true,
  voucherValidityMonths: true,
} satisfies Prisma.RefundPolicySelect;

/** Deliberately no onlineJoinUrl: it is released only to confirmed bookings. */
const sessionSelect = {
  id: true,
  workshopId: true,
  startsAt: true,
  endsAt: true,
  capacity: true,
  priceCentsOverride: true,
  location: true,
} satisfies Prisma.SessionSelect;

type CardRow = Prisma.WorkshopGetPayload<{ select: typeof cardSelect }>;
type SessionRow = Prisma.SessionGetPayload<{ select: typeof sessionSelect }>;

/** Public sessions: on sale now, for a class that is published. */
function onSale(now: Date): Prisma.SessionWhereInput {
  return {
    status: SessionStatus.SCHEDULED,
    startsAt: { gt: now },
    workshop: { status: WorkshopStatus.PUBLISHED },
  };
}

@Injectable()
export class CatalogueService {
  constructor(private readonly prisma: PrismaService) {}

  async listWorkshops(now: Date): Promise<WorkshopCard[]> {
    const workshops = await this.prisma.workshop.findMany({
      where: { status: WorkshopStatus.PUBLISHED },
      orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }],
      select: cardSelect,
    });
    const next = await this.nextSessions(
      workshops.map((w) => w.id),
      now,
    );
    return workshops.map((w) => this.toCard(w, next.get(w.id) ?? null));
  }

  async getWorkshop(slug: string, now: Date): Promise<WorkshopDetail> {
    const workshop = await this.prisma.workshop.findFirst({
      where: { slug, status: WorkshopStatus.PUBLISHED },
      select: {
        ...cardSelect,
        description: true,
        skillLevel: true,
        whatsIncluded: true,
        whatToBring: true,
        images: {
          select: { ...imageSelect, isHero: true },
          orderBy: { position: 'asc' },
        },
        refundPolicy: { select: cancellationSelect },
      },
    });
    if (!workshop) throw new NotFoundException('Class not found');

    const [next, cancellation] = await Promise.all([
      this.nextSessions([workshop.id], now),
      workshop.refundPolicy
        ? Promise.resolve(workshop.refundPolicy)
        : this.prisma.refundPolicy.findFirst({
            where: { isDefault: true },
            select: cancellationSelect,
          }),
    ]);

    // The gallery keeps the admin's order; the hero is picked out of it.
    const hero = workshop.images.find((i) => i.isHero) ?? workshop.images[0];

    return {
      ...this.toCard(
        { ...workshop, images: hero ? [hero] : [] },
        next.get(workshop.id) ?? null,
      ),
      description: workshop.description,
      skillLevel: workshop.skillLevel,
      whatsIncluded: workshop.whatsIncluded,
      whatToBring: workshop.whatToBring,
      images: workshop.images.map(toImage),
      cancellation: cancellation ?? null,
    };
  }

  /** Upcoming dates for one class, sold-out ones included and flagged. */
  async listWorkshopSessions(slug: string, now: Date): Promise<SessionView[]> {
    const workshop = await this.prisma.workshop.findFirst({
      where: { slug, status: WorkshopStatus.PUBLISHED },
      select: { id: true, basePriceCents: true },
    });
    if (!workshop) throw new NotFoundException('Class not found');

    const sessions = await this.prisma.session.findMany({
      where: { ...onSale(now), workshopId: workshop.id },
      orderBy: { startsAt: 'asc' },
      take: WORKSHOP_SESSIONS_LIMIT,
      select: sessionSelect,
    });
    const taken = await this.seatsTaken(
      sessions.map((s) => s.id),
      now,
    );
    return sessions.map((s) =>
      toSession(s, workshop.basePriceCents, taken.get(s.id) ?? 0),
    );
  }

  /** Every class's dates inside [from, to), for the calendar. */
  async listSessions(
    from: Date,
    to: Date,
    now: Date,
  ): Promise<CalendarSessionView[]> {
    const sessions = await this.prisma.session.findMany({
      // Replaces onSale's startsAt, so `gt: now` is restated: a calendar
      // month that began yesterday still only shows what is on sale.
      where: { ...onSale(now), startsAt: { gt: now, gte: from, lt: to } },
      orderBy: { startsAt: 'asc' },
      select: {
        ...sessionSelect,
        workshop: {
          select: {
            slug: true,
            title: true,
            productType: true,
            deliveryMode: true,
            basePriceCents: true,
          },
        },
      },
    });
    const taken = await this.seatsTaken(
      sessions.map((s) => s.id),
      now,
    );
    return sessions.map(({ workshop, ...s }) => ({
      ...toSession(s, workshop.basePriceCents, taken.get(s.id) ?? 0),
      workshop: {
        slug: workshop.slug,
        title: workshop.title,
        productType: workshop.productType,
        deliveryMode: workshop.deliveryMode,
      },
    }));
  }

  /**
   * The live count for one session. Answers for cancelled and past sessions
   * too, so a page left open can say "no longer available" rather than 404.
   * A session of an unpublished class does not exist as far as the public
   * can tell.
   */
  async availability(id: string, now: Date): Promise<AvailabilityView> {
    const session = await this.prisma.session.findFirst({
      where: { id, workshop: { status: WorkshopStatus.PUBLISHED } },
      select: { id: true, status: true, capacity: true, startsAt: true },
    });
    if (!session) throw new NotFoundException('Session not found');

    const taken = (await this.seatsTaken([session.id], now)).get(session.id);
    const left = seatsLeft(session.capacity, taken ?? 0);
    return {
      sessionId: session.id,
      status: session.status,
      capacity: session.capacity,
      seatsLeft: left,
      isFull: left === 0,
      onSale:
        session.status === SessionStatus.SCHEDULED && session.startsAt > now,
      checkedAt: now.toISOString(),
    };
  }

  /** Seats held per session, in one grouped query. */
  private async seatsTaken(
    sessionIds: string[],
    now: Date,
  ): Promise<Map<string, number>> {
    if (sessionIds.length === 0) return new Map();
    const rows = await this.prisma.booking.groupBy({
      by: ['sessionId'],
      where: { sessionId: { in: sessionIds }, ...seatHoldingBookings(now) },
      _sum: { seats: true },
    });
    return new Map(rows.map((r) => [r.sessionId, r._sum.seats ?? 0]));
  }

  /** The soonest session with a seat left, per workshop. */
  private async nextSessions(
    workshopIds: string[],
    now: Date,
  ): Promise<Map<string, { id: string; startsAt: Date; seatsLeft: number }>> {
    if (workshopIds.length === 0) return new Map();
    const sessions = await this.prisma.session.findMany({
      where: { ...onSale(now), workshopId: { in: workshopIds } },
      orderBy: { startsAt: 'asc' },
      select: { id: true, workshopId: true, startsAt: true, capacity: true },
      // A handful of dates per class; the cap only guards against a runaway.
      take: workshopIds.length * WORKSHOP_SESSIONS_LIMIT,
    });
    const taken = await this.seatsTaken(
      sessions.map((s) => s.id),
      now,
    );

    const next = new Map<
      string,
      { id: string; startsAt: Date; seatsLeft: number }
    >();
    for (const s of sessions) {
      if (next.has(s.workshopId)) continue;
      const left = seatsLeft(s.capacity, taken.get(s.id) ?? 0);
      if (left > 0) {
        next.set(s.workshopId, {
          id: s.id,
          startsAt: s.startsAt,
          seatsLeft: left,
        });
      }
    }
    return next;
  }

  private toCard(
    w: CardRow,
    next: { id: string; startsAt: Date; seatsLeft: number } | null,
  ): WorkshopCard {
    return {
      slug: w.slug,
      title: w.title,
      summary: w.summary,
      productType: w.productType,
      deliveryMode: w.deliveryMode,
      durationMinutes: w.durationMinutes,
      priceCents: w.basePriceCents,
      minAge: w.minAge,
      maxAge: w.maxAge,
      requiresAccompanyingAdult: w.requiresAccompanyingAdult,
      heroImage: w.images[0] ? toImage(w.images[0]) : null,
      nextSession: next
        ? {
            id: next.id,
            startsAt: next.startsAt.toISOString(),
            seatsLeft: next.seatsLeft,
          }
        : null,
    };
  }
}

function toImage(i: ImageView): ImageView {
  return { url: i.url, alt: i.alt, width: i.width, height: i.height };
}

function toSession(
  s: SessionRow,
  basePriceCents: number,
  taken: number,
): SessionView {
  const left = seatsLeft(s.capacity, taken);
  return {
    id: s.id,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    priceCents: sessionPriceCents(basePriceCents, s.priceCentsOverride),
    capacity: s.capacity,
    seatsLeft: left,
    isFull: left === 0,
    location: s.location,
  };
}
