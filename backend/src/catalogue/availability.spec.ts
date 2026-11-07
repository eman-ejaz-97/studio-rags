import { BookingStatus } from '@prisma/client';
import {
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
