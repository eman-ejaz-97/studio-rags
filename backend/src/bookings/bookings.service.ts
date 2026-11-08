import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  Prisma,
  SessionStatus,
  WorkshopStatus,
} from '@prisma/client';
import {
  holdsSeats,
  seatHoldingBookings,
  seatsLeft,
  sessionPriceCents,
} from '../catalogue/availability';
import type { ProblemException } from '../common/filters/problem-details.filter';
import { PrismaService } from '../prisma/prisma.service';
import { decodeCursor, encodeCursor, olderThan } from './booking-cursor';
import {
  BOOKING_NOT_FOUND,
  SESSION_NOT_FOUND,
  isCapacityRefusal,
  isReferenceClash,
  sessionFull,
  sessionNotOnSale,
} from './booking-errors';
import { newBookingReference, normaliseReference } from './booking-reference';
import {
  attendeeProblems,
  holdExpiry,
  isSameRequest,
  notOnSaleReason,
  priceSnapshot,
} from './booking-rules';
import { bookingViewSelect, toBookingView } from './booking-view';
import type {
  BookingPage,
  BookingRequest,
  BookingView,
  ConfirmOutcome,
  CreatedBooking,
  PayableHold,
} from './bookings.types';

type Tx = Prisma.TransactionClient;

/**
 * Prisma's defaults (2 s to get a connection, 5 s in total) are too tight
 * when a popular session's bookings queue for its lock and the pool is busy.
 * Each transaction holds the lock for a few milliseconds; these limits only
 * bound how long a request waits behind the others.
 */
const TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 15_000 };

/**
 * A clash is about one draw in 24 million at her volume. Five in a row means
 * something other than chance, and the error is better surfaced than hidden.
 */
export const MAX_REFERENCE_ATTEMPTS = 5;

const sessionForBookingSelect = {
  status: true,
  startsAt: true,
  capacity: true,
  priceCentsOverride: true,
  workshop: {
    select: {
      status: true,
      productType: true,
      basePriceCents: true,
      minAge: true,
      maxAge: true,
    },
  },
} satisfies Prisma.SessionSelect;

/** PENDING with time left on the hold. */
function liveHold(now: Date): Prisma.BookingWhereInput {
  return { status: BookingStatus.PENDING, holdExpiresAt: { gt: now } };
}

/**
 * The customer's history: everything that was ever confirmed (cancelled and
 * refunded ones included), and the hold they are paying for now. Holds that
 * ran out or were replaced were never bookings, so they stay out of the list;
 * GET /bookings/:reference still answers for them.
 */
function inHistory(now: Date): Prisma.BookingWhereInput {
  return { OR: [{ confirmedAt: { not: null } }, liveHold(now)] };
}

/**
 * FR-A5 step 2. Locks the session row, so every write that adds seats to this
 * session queues behind it, and reads the database's clock in the same
 * statement. Null when there is no such session.
 *
 * The clock is now(), the transaction's start: the same instant the capacity
 * trigger reads inside this transaction, so this service's count and the
 * trigger's can never disagree about whether a hold has run out.
 */
async function lockSession(tx: Tx, sessionId: string): Promise<Date | null> {
  const rows = await tx.$queryRaw<{ id: string; now: Date }[]>`
    SELECT id, now() AS now FROM sessions WHERE id = ${sessionId} FOR UPDATE`;
  return rows[0]?.now ?? null;
}

/** FR-A5 step 3, with the catalogue's own filter. */
async function seatsTaken(
  tx: Tx,
  sessionId: string,
  now: Date,
): Promise<number> {
  const { _sum } = await tx.booking.aggregate({
    where: { sessionId, ...seatHoldingBookings(now) },
    _sum: { seats: true },
  });
  return _sum.seats ?? 0;
}

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** A method of its own so tests can pin it, as with TokenService.randomToken. */
  newReference(): string {
    return newBookingReference();
  }

  /**
   * FR-C6 and FR-A5. Holds places on a session for HOLD_MINUTES, at the price
   * of the moment. The hold occupies its places from the instant it exists,
   * before any card is charged.
   *
   * Everything happens in one transaction that starts by locking the session
   * row: concurrent attempts on the same session queue, attempts on other
   * sessions never wait. A clash on the reference rolls the whole attempt
   * back, lock included, and it starts again with a new one.
   */
  async create(
    userId: string,
    request: BookingRequest,
  ): Promise<CreatedBooking> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (tx) => this.createLocked(tx, userId, request, this.newReference()),
          TRANSACTION_OPTIONS,
        );
      } catch (error) {
        if (isReferenceClash(error) && attempt < MAX_REFERENCE_ATTEMPTS) {
          continue;
        }
        if (isCapacityRefusal(error)) {
          throw await this.backstopRefusal(request.sessionId, error);
        }
        throw error;
      }
    }
  }

  private async createLocked(
    tx: Tx,
    userId: string,
    request: BookingRequest,
    reference: string,
  ): Promise<CreatedBooking> {
    const now = await lockSession(tx, request.sessionId);
    if (!now) throw new NotFoundException(SESSION_NOT_FOUND);

    // Read after the lock, so a cancellation or price change that committed
    // while this request queued is the one it sees.
    const session = await tx.session.findUniqueOrThrow({
      where: { id: request.sessionId },
      select: sessionForBookingSelect,
    });
    if (session.workshop.status !== WorkshopStatus.PUBLISHED) {
      throw new NotFoundException(SESSION_NOT_FOUND);
    }
    const closed = notOnSaleReason(session, now);
    if (closed) throw sessionNotOnSale(closed);

    const problems = attendeeProblems(session.workshop, request);
    if (problems.length > 0) throw new BadRequestException(problems);

    // One live hold per customer per session. The same request again (a
    // double-click, a retry after a dropped answer) gets that hold back, with
    // its original expiry, so resending cannot extend it. A different request
    // (more places, another child) replaces it: the old hold is cancelled
    // first so its places count towards the new one. If the new one does not
    // fit, the transaction rolls back and the old hold stands.
    const existing = await tx.booking.findFirst({
      where: { userId, sessionId: request.sessionId, ...liveHold(now) },
      select: { id: true, ...bookingViewSelect },
    });
    if (existing && isSameRequest(existing, request)) {
      return { booking: toBookingView(existing, now), created: false };
    }
    if (existing) {
      await tx.booking.update({
        where: { id: existing.id },
        data: {
          status: BookingStatus.CANCELLED,
          cancelledAt: now,
          cancellationReason: `Replaced by ${reference}`,
        },
      });
    }

    const left = seatsLeft(
      session.capacity,
      await seatsTaken(tx, request.sessionId, now),
    );
    if (request.seats > left) {
      throw sessionFull(left, existing?.seats ?? 0);
    }

    const booking = await tx.booking.create({
      data: {
        reference,
        sessionId: request.sessionId,
        userId,
        seats: request.seats,
        status: BookingStatus.PENDING,
        holdExpiresAt: holdExpiry(now),
        ...priceSnapshot(
          sessionPriceCents(
            session.workshop.basePriceCents,
            session.priceCentsOverride,
          ),
          request.seats,
        ),
        photoConsentOptOut: request.photoConsentOptOut,
        attendeeNotes: request.notes,
        attendees: {
          create: request.attendees.map((a) => ({
            firstName: a.firstName,
            age: a.age,
          })),
        },
      },
      select: bookingViewSelect,
    });
    return { booking: toBookingView(booking, now), created: true };
  }

  /**
   * The trigger refused what this service's own count allowed. Both count the
   * same way, at the same instant, under the same lock, so this means a bug
   * and is logged as an error. The customer still gets the ordinary answer,
   * with a fresh count.
   */
  private async backstopRefusal(
    sessionId: string,
    error: unknown,
  ): Promise<ProblemException> {
    this.logger.error(
      `Capacity trigger refused a hold on session ${sessionId} that the booking service allowed`,
      error instanceof Error ? error.message : String(error),
    );
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { capacity: true },
    });
    const taken = await seatsTaken(this.prisma, sessionId, new Date());
    return sessionFull(seatsLeft(session?.capacity ?? 0, taken));
  }

  /** FR-C10. The customer's own bookings, newest first. */
  async list(
    userId: string,
    page: { cursor?: string; limit: number },
    now: Date,
  ): Promise<BookingPage> {
    const after = page.cursor ? decodeCursor(page.cursor) : null;
    const rows = await this.prisma.booking.findMany({
      where: {
        AND: [{ userId }, inHistory(now), ...(after ? [olderThan(after)] : [])],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One more than the page, to know whether another page follows.
      take: page.limit + 1,
      select: { id: true, ...bookingViewSelect },
    });
    const shown = rows.slice(0, page.limit);
    const last = shown.at(-1);
    return {
      bookings: shown.map((row) => toBookingView(row, now)),
      nextCursor: rows.length > page.limit && last ? encodeCursor(last) : null,
    };
  }

  /**
   * One of the customer's own bookings. Another customer's reference is a
   * 404, not a 403, so references cannot be probed for existence.
   */
  async get(
    userId: string,
    reference: string,
    now: Date,
  ): Promise<BookingView> {
    const normalised = normaliseReference(reference);
    const row = normalised
      ? await this.prisma.booking.findFirst({
          where: { reference: normalised, userId },
          select: bookingViewSelect,
        })
      : null;
    if (!row) throw new NotFoundException(BOOKING_NOT_FOUND);
    return toBookingView(row, now);
  }

  /**
   * FR-A5 step 5, the sweep half. Marks holds that ran out as EXPIRED, and any
   * PENDING row without a hold time, which never held places either.
   *
   * Tidying only: the seat count already ignores lapsed holds, so nothing
   * depends on when this last ran, which matters because Render's free
   * instance sleeps. Compares against the database's clock, like the booking
   * transaction and the trigger. Returns the number of holds expired.
   */
  async expireLapsedHolds(): Promise<number> {
    const [{ now }] = await this.prisma.$queryRaw<
      { now: Date }[]
    >`SELECT now() AS now`;
    const { count } = await this.prisma.booking.updateMany({
      where: {
        status: BookingStatus.PENDING,
        OR: [{ holdExpiresAt: { lte: now } }, { holdExpiresAt: null }],
      },
      data: { status: BookingStatus.EXPIRED },
    });
    return count;
  }

  // ─── The payment seam ──────────────────────────────────────────────────────
  // The payments slice builds on these two and nothing else in this module.

  /**
   * For POST /payments/intent. The caller's own hold with time left on it,
   * with what to charge. Null for anything else (unknown, someone else's,
   * lapsed, already paid), so each reads the same to the caller.
   *
   * The hold may run out between this answer and the payment. That case is
   * confirmBooking's to settle, under the lock.
   */
  async findPayableHold(
    userId: string,
    reference: string,
    now: Date = new Date(),
  ): Promise<PayableHold | null> {
    const normalised = normaliseReference(reference);
    if (!normalised) return null;
    const hold = await this.prisma.booking.findFirst({
      where: { reference: normalised, userId, ...liveHold(now) },
      select: {
        id: true,
        reference: true,
        userId: true,
        sessionId: true,
        seats: true,
        totalCents: true,
        holdExpiresAt: true,
      },
    });
    if (!hold?.holdExpiresAt) return null;
    return { ...hold, holdExpiresAt: hold.holdExpiresAt, currency: 'aud' };
  }

  /**
   * For the payment_intent.succeeded webhook (SPEC § 5 step 4), keyed on the
   * booking id the PaymentIntent carries. Idempotent: a repeat delivery of
   * the same event answers 'already-confirmed' and changes nothing.
   *
   * A payment that lands after its hold ran out is still honoured if its
   * places are free, whether or not the sweep has marked the hold EXPIRED: the
   * customer has paid, and confirming takes nobody's place. Only when the
   * places have gone to someone else, or the booking or session was
   * cancelled, is it refused; each refusal means the payments slice refunds
   * and tells the admin (step 5), never that the session is overbooked.
   *
   * Locks the session before touching the booking, the same order as create,
   * so the two cannot deadlock.
   */
  async confirmBooking(bookingId: string): Promise<ConfirmOutcome> {
    const found = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { sessionId: true },
    });
    if (!found) return { kind: 'refused', reason: 'not-found', bookingId };

    return this.prisma.$transaction(async (tx): Promise<ConfirmOutcome> => {
      const now = await lockSession(tx, found.sessionId);
      // The session row cannot be deleted while a booking references it.
      if (!now) throw new Error(`Session ${found.sessionId} has vanished`);

      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: {
          reference: true,
          status: true,
          seats: true,
          holdExpiresAt: true,
          session: { select: { status: true, capacity: true } },
        },
      });
      const { reference } = booking;

      if (booking.status === BookingStatus.CONFIRMED) {
        return { kind: 'already-confirmed', bookingId, reference };
      }
      if (
        booking.status === BookingStatus.CANCELLED ||
        booking.status === BookingStatus.REFUNDED
      ) {
        return { kind: 'refused', reason: 'cancelled', bookingId };
      }
      if (booking.session.status !== SessionStatus.SCHEDULED) {
        return { kind: 'refused', reason: 'session-unavailable', bookingId };
      }
      // A live hold already counts in seatsTaken; a lapsed one must fit again.
      if (!holdsSeats(booking, now)) {
        const left = seatsLeft(
          booking.session.capacity,
          await seatsTaken(tx, found.sessionId, now),
        );
        if (booking.seats > left) {
          return { kind: 'refused', reason: 'no-seats', bookingId };
        }
      }

      await tx.booking.update({
        where: { id: bookingId },
        data: { status: BookingStatus.CONFIRMED, confirmedAt: now },
      });
      return { kind: 'confirmed', bookingId, reference };
    }, TRANSACTION_OPTIONS);
  }
}
