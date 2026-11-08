import { BookingStatus, Prisma } from '@prisma/client';

/**
 * The bookings that occupy seats at `now`: every CONFIRMED booking, and every
 * PENDING one whose hold has not run out. An expired hold gives its seats back
 * the moment it expires, whether or not the sweep has marked it EXPIRED yet.
 *
 * The booking transaction (bookings.service.ts) counts with this same filter,
 * under the session row lock, so the catalogue and checkout never disagree.
 * The database's backstop trigger has the same rule in SQL
 * (booking_holds_seats, migration 20261108120000_booking_capacity_backstop).
 */
export function seatHoldingBookings(now: Date): Prisma.BookingWhereInput {
  return {
    OR: [
      { status: BookingStatus.CONFIRMED },
      { status: BookingStatus.PENDING, holdExpiresAt: { gt: now } },
    ],
  };
}

/** seatHoldingBookings for one booking already in hand. */
export function holdsSeats(
  booking: { status: BookingStatus; holdExpiresAt: Date | null },
  now: Date,
): boolean {
  return (
    booking.status === BookingStatus.CONFIRMED ||
    (booking.status === BookingStatus.PENDING &&
      booking.holdExpiresAt !== null &&
      booking.holdExpiresAt > now)
  );
}

/**
 * Never negative. Capacity may be lowered below what is already booked
 * (§ 5, ADR-012); that session is simply full, not "-2 left".
 */
export function seatsLeft(capacity: number, taken: number): number {
  return Math.max(0, capacity - taken);
}

/** A session's own price wins over the workshop default (ADR-012). */
export function sessionPriceCents(
  basePriceCents: number,
  priceCentsOverride: number | null,
): number {
  return priceCentsOverride ?? basePriceCents;
}
