import type { BookingStatus, DeliveryMode, ProductType } from '@prisma/client';

/**
 * What the bookings API returns. Built by hand from explicit selects, like the
 * catalogue's views, so a column added later cannot reach a customer by
 * accident, and the Zoom link only appears where toBookingView allows it.
 */

export interface AttendeeView {
  firstName: string;
  age: number | null;
}

export interface BookingView {
  reference: string;
  /**
   * EXPIRED as soon as a hold runs out, whether or not the sweep has marked
   * the row yet. The same rule the seat count uses.
   */
  status: BookingStatus;
  /** Places. For the kids class, children (ADR-016). */
  seats: number;
  /** Snapshotted when the hold was made; never recomputed (ADR-012). */
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  /** When an unpaid hold lets its places go. Null unless the status is PENDING. */
  holdExpiresAt: string | null;
  /** True when the customer asked not to be photographed (ADR-018). */
  photoConsentOptOut: boolean;
  notes: string | null;
  /** The children, in the order given, for the kids class. Empty otherwise. */
  attendees: AttendeeView[];
  confirmedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  session: {
    id: string;
    startsAt: string;
    endsAt: string;
    location: string | null;
    /** The Zoom link: set only on a CONFIRMED booking (ADR-015). */
    onlineJoinUrl: string | null;
    workshop: {
      slug: string;
      title: string;
      productType: ProductType;
      deliveryMode: DeliveryMode;
      requiresAccompanyingAdult: boolean;
    };
  };
}

export interface BookingPage {
  bookings: BookingView[];
  /** Pass back as `cursor` for the next page. Null on the last page. */
  nextCursor: string | null;
}

/** What POST /bookings asks for, after validation and trimming. */
export interface BookingRequest {
  sessionId: string;
  seats: number;
  /** Empty for a class that does not take attendee details. */
  attendees: { firstName: string; age: number }[];
  photoConsentOptOut: boolean;
  /** Null when left blank. */
  notes: string | null;
}

export interface CreatedBooking {
  booking: BookingView;
  /** False when an identical live hold already existed and was returned. */
  created: boolean;
}

// ─── The payment seam ────────────────────────────────────────────────────────

/**
 * A live hold, as the payments slice needs it to create a Stripe
 * PaymentIntent: whose it is, how much to charge, and until when.
 */
export interface PayableHold {
  id: string;
  reference: string;
  userId: string;
  sessionId: string;
  seats: number;
  totalCents: number;
  currency: 'aud';
  holdExpiresAt: Date;
}

/**
 * Why a paid booking could not be confirmed. Each one means the customer's
 * money must go back (SPEC § 5 step 5): the payments slice refunds and tells
 * the admin.
 */
export type ConfirmRefusal =
  /** No booking has that id. */
  | 'not-found'
  /** The booking was cancelled or refunded, or replaced by a newer hold. */
  | 'cancelled'
  /** The studio cancelled the session, or it has been marked completed. */
  | 'session-unavailable'
  /** The hold ran out and its places have since gone to someone else. */
  | 'no-seats';

export type ConfirmOutcome =
  | { kind: 'confirmed'; bookingId: string; reference: string }
  /** A repeat of a confirmation that already happened. Nothing changed. */
  | { kind: 'already-confirmed'; bookingId: string; reference: string }
  | { kind: 'refused'; reason: ConfirmRefusal; bookingId: string };
