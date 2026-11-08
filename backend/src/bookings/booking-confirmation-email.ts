import type { Prisma } from '@prisma/client';
import type { BookingConfirmationEmail } from '../mail/mail.service';

/**
 * Everything the confirmation email says, and who it goes to. Read after the
 * booking is confirmed, so it shows the booking as it stands then: the
 * price snapshotted on the hold (ADR-012), and the class as it is now.
 */
export const confirmationEmailSelect = {
  id: true,
  reference: true,
  seats: true,
  totalCents: true,
  user: { select: { email: true, firstName: true } },
  session: {
    select: {
      startsAt: true,
      endsAt: true,
      location: true,
      onlineJoinUrl: true,
      workshop: {
        select: {
          title: true,
          deliveryMode: true,
          requiresAccompanyingAdult: true,
          whatToBring: true,
        },
      },
    },
  },
} satisfies Prisma.BookingSelect;

export type ConfirmationEmailRow = Prisma.BookingGetPayload<{
  select: typeof confirmationEmailSelect;
}>;

/**
 * For a CONFIRMED booking only: the email carries the Zoom link, which
 * ADR-015 releases to confirmed bookings and nobody else.
 *
 * `paid` comes from the caller, which knows whether money changed hands:
 * false for the interim no-payment confirmation, true for the Stripe
 * webhook. Nothing here guesses it from the booking or the config.
 */
export function toConfirmationEmail(
  row: ConfirmationEmailRow,
  { paid }: { paid: boolean },
): BookingConfirmationEmail {
  const { session, user } = row;
  return {
    to: user.email,
    bookingId: row.id,
    paid,
    firstName: user.firstName,
    reference: row.reference,
    workshopTitle: session.workshop.title,
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    deliveryMode: session.workshop.deliveryMode,
    location: session.location,
    onlineJoinUrl: session.onlineJoinUrl,
    seats: row.seats,
    requiresAccompanyingAdult: session.workshop.requiresAccompanyingAdult,
    totalCents: row.totalCents,
    whatToBring: session.workshop.whatToBring,
  };
}
