import { BookingStatus } from '@prisma/client';
import {
  holdsSeats,
  seatHoldingBookings,
  seatsLeft,
  sessionPriceCents,
} from './availability';

describe('seatsLeft', () => {
  it.each([
    [8, 0, 8],
    [8, 5, 3],
    [8, 8, 0],
    // Capacity lowered below what is booked: full, never negative.
    [3, 5, 0],
  ])('capacity %i with %i taken leaves %i', (capacity, taken, expected) => {
    expect(seatsLeft(capacity, taken)).toBe(expected);
  });
});

describe('sessionPriceCents', () => {
  it('uses the workshop price when the session has none', () => {
    expect(sessionPriceCents(8200, null)).toBe(8200);
  });

  it('uses the session override when set, including a free session', () => {
    expect(sessionPriceCents(8200, 9500)).toBe(9500);
    expect(sessionPriceCents(8200, 0)).toBe(0);
  });
});

describe('seatHoldingBookings', () => {
  it('counts confirmed bookings and holds that end after now', () => {
    const now = new Date('2026-11-14T00:00:00.000Z');

    expect(seatHoldingBookings(now)).toEqual({
      OR: [
        { status: BookingStatus.CONFIRMED },
        { status: BookingStatus.PENDING, holdExpiresAt: { gt: now } },
      ],
    });
  });
});

describe('holdsSeats', () => {
  const now = new Date('2026-11-14T00:00:00.000Z');
  const at = (ms: number) => new Date(now.getTime() + ms);

  /**
   * Evaluates the filter above against one row, for exactly the shape it
   * has. If seatHoldingBookings changes shape this throws, and the test says
   * the two definitions need looking at together.
   */
  function filterMatches(booking: {
    status: BookingStatus;
    holdExpiresAt: Date | null;
  }): boolean {
    const where = seatHoldingBookings(now) as {
      OR: { status: BookingStatus; holdExpiresAt?: { gt: Date } }[];
    };
    return where.OR.some((clause) => {
      const keys = Object.keys(clause).sort().join(',');
      if (keys !== 'status' && keys !== 'holdExpiresAt,status') {
        throw new Error(`Unexpected clause shape: ${keys}`);
      }
      if (clause.status !== booking.status) return false;
      if (!clause.holdExpiresAt) return true;
      return (
        booking.holdExpiresAt !== null &&
        booking.holdExpiresAt > clause.holdExpiresAt.gt
      );
    });
  }

  it.each([
    [BookingStatus.CONFIRMED, null, true],
    [BookingStatus.CONFIRMED, at(-60_000), true],
    [BookingStatus.PENDING, at(1), true],
    [BookingStatus.PENDING, at(0), false],
    [BookingStatus.PENDING, at(-1), false],
    [BookingStatus.PENDING, null, false],
    [BookingStatus.EXPIRED, at(60_000), false],
    [BookingStatus.CANCELLED, at(60_000), false],
    [BookingStatus.REFUNDED, null, false],
  ])(
    '%s with a hold ending %s: %s, the same answer as the query filter',
    (status, holdExpiresAt, expected) => {
      const booking = { status, holdExpiresAt };

      expect(holdsSeats(booking, now)).toBe(expected);
      expect(filterMatches(booking)).toBe(expected);
    },
  );
});
