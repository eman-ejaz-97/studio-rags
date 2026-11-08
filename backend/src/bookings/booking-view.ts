import { BookingStatus, Prisma } from '@prisma/client';
import { holdsSeats } from '../catalogue/availability';
import type { BookingView } from './bookings.types';

/** Everything a BookingView is made from, and nothing else. */
export const bookingViewSelect = {
  reference: true,
  status: true,
  seats: true,
  subtotalCents: true,
  discountCents: true,
  totalCents: true,
  holdExpiresAt: true,
  photoConsentOptOut: true,
  attendeeNotes: true,
  confirmedAt: true,
  cancelledAt: true,
  createdAt: true,
  attendees: {
    select: { firstName: true, age: true },
    // Ids are cuids, which sort in creation order, and the attendees are
    // created in the order the customer gave them.
    orderBy: { id: 'asc' },
  },
  session: {
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      location: true,
      // Selected so toBookingView can decide; it releases it only on a
      // CONFIRMED booking (ADR-015).
      onlineJoinUrl: true,
      workshop: {
        select: {
          slug: true,
          title: true,
          productType: true,
          deliveryMode: true,
          requiresAccompanyingAdult: true,
        },
      },
    },
  },
} satisfies Prisma.BookingSelect;

export type BookingViewRow = Prisma.BookingGetPayload<{
  select: typeof bookingViewSelect;
}>;

/**
 * The status a customer should see. A PENDING row whose hold has run out is
 * EXPIRED, whether or not the sweep has got to it: the same rule as the seat
 * count, so what she is told and what the room holds always match.
 */
export function effectiveStatus(
  booking: { status: BookingStatus; holdExpiresAt: Date | null },
  now: Date,
): BookingStatus {
  if (booking.status === BookingStatus.PENDING && !holdsSeats(booking, now)) {
    return BookingStatus.EXPIRED;
  }
  return booking.status;
}

export function toBookingView(row: BookingViewRow, now: Date): BookingView {
  const status = effectiveStatus(row, now);
  const { session } = row;
  return {
    reference: row.reference,
    status,
    seats: row.seats,
    subtotalCents: row.subtotalCents,
    discountCents: row.discountCents,
    totalCents: row.totalCents,
    holdExpiresAt:
      status === BookingStatus.PENDING && row.holdExpiresAt
        ? row.holdExpiresAt.toISOString()
        : null,
    photoConsentOptOut: row.photoConsentOptOut,
    notes: row.attendeeNotes,
    attendees: row.attendees.map((a) => ({
      firstName: a.firstName,
      age: a.age,
    })),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    session: {
      id: session.id,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
      location: session.location,
      onlineJoinUrl:
        status === BookingStatus.CONFIRMED ? session.onlineJoinUrl : null,
      workshop: {
        slug: session.workshop.slug,
        title: session.workshop.title,
        productType: session.workshop.productType,
        deliveryMode: session.workshop.deliveryMode,
        requiresAccompanyingAdult: session.workshop.requiresAccompanyingAdult,
      },
    },
  };
}
