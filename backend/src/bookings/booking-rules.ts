import { ProductType, SessionStatus } from '@prisma/client';
import type { AttendeeView, BookingRequest } from './bookings.types';

/** How long an unpaid hold keeps its places (SPEC § 5, FR-A5 step 1). */
export const HOLD_MINUTES = 15;

/**
 * The most places one booking can take. Her classes hold 6 to 12, and a
 * group bigger than this is a private event, which she quotes offline
 * (ADR-019). The session's own capacity still applies below this.
 */
export const MAX_SEATS_PER_BOOKING = 8;

export function holdExpiry(now: Date): Date {
  return new Date(now.getTime() + HOLD_MINUTES * 60_000);
}

export interface PriceSnapshot {
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
}

/**
 * The price, copied onto the booking when the hold is made and never worked
 * out again (ADR-012). For the kids class one place is one child, and the
 * accompanying adult comes on that ticket (ADR-033). Discounts arrive with
 * gift cards and vouchers; until then there are none.
 */
export function priceSnapshot(
  unitPriceCents: number,
  seats: number,
): PriceSnapshot {
  const subtotalCents = unitPriceCents * seats;
  return { subtotalCents, discountCents: 0, totalCents: subtotalCents };
}

export type NotOnSaleReason = 'cancelled' | 'completed' | 'started';

/** Null when the session can be booked; otherwise why not. */
export function notOnSaleReason(
  session: { status: SessionStatus; startsAt: Date },
  now: Date,
): NotOnSaleReason | null {
  if (session.status === SessionStatus.CANCELLED) return 'cancelled';
  if (session.status === SessionStatus.COMPLETED) return 'completed';
  if (session.startsAt <= now) return 'started';
  return null;
}

export interface AgeRule {
  productType: ProductType;
  minAge: number | null;
  maxAge: number | null;
}

/**
 * Whether a class names its attendees: the kids class, and any class with an
 * age limit, because the ages are what get checked at the point of sale
 * rather than at the door (§ 5, BookingAttendee).
 */
export function takesAttendees(workshop: AgeRule): boolean {
  return (
    workshop.productType === ProductType.KIDS ||
    workshop.minAge !== null ||
    workshop.maxAge !== null
  );
}

/**
 * Every reason the attendee list does not suit this class, in words for the
 * customer. Empty when it does.
 */
export function attendeeProblems(
  workshop: AgeRule,
  request: Pick<BookingRequest, 'seats' | 'attendees'>,
): string[] {
  const { seats, attendees } = request;

  if (!takesAttendees(workshop)) {
    return attendees.length > 0
      ? ['This class does not take attendee details. Leave them out.']
      : [];
  }

  if (attendees.length !== seats) {
    return [
      `Give a first name and age for each child: ${count(seats, 'place', 'places')} booked, ${count(attendees.length, 'child', 'children')} listed.`,
    ];
  }

  const problems: string[] = [];
  attendees.forEach((attendee, i) => {
    const label = attendee.firstName || `Child ${i + 1}`;
    if (!attendee.firstName) {
      problems.push(`Enter the first name of child ${i + 1}.`);
    }
    if (!withinAgeRange(attendee.age, workshop)) {
      problems.push(
        `${label} is ${attendee.age}. This class is for ${ageRange(workshop)}.`,
      );
    }
  });
  return problems;
}

function withinAgeRange(age: number, workshop: AgeRule): boolean {
  return (
    (workshop.minAge === null || age >= workshop.minAge) &&
    (workshop.maxAge === null || age <= workshop.maxAge)
  );
}

/** "ages 7 to 15", "ages 7 and over", "ages up to 15". */
export function ageRange(workshop: AgeRule): string {
  const { minAge, maxAge } = workshop;
  if (minAge !== null && maxAge !== null) return `ages ${minAge} to ${maxAge}`;
  if (minAge !== null) return `ages ${minAge} and over`;
  if (maxAge !== null) return `ages up to ${maxAge}`;
  return 'all ages';
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Whether a request asks for exactly what an existing hold already has. A
 * double-click or a retried request is answered with that hold rather than a
 * second one; anything else replaces it.
 */
export function isSameRequest(
  existing: {
    seats: number;
    photoConsentOptOut: boolean;
    attendeeNotes: string | null;
    attendees: AttendeeView[];
  },
  request: BookingRequest,
): boolean {
  return (
    existing.seats === request.seats &&
    existing.photoConsentOptOut === request.photoConsentOptOut &&
    existing.attendeeNotes === request.notes &&
    existing.attendees.length === request.attendees.length &&
    existing.attendees.every(
      (a, i) =>
        a.firstName === request.attendees[i].firstName &&
        a.age === request.attendees[i].age,
    )
  );
}
