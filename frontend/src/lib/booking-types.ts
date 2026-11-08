/**
 * Bookings as the API returns them (backend/src/bookings/bookings.types.ts).
 * Kept in step by hand, like catalogue-types.ts.
 */

import type { DeliveryMode, ProductType } from "./catalogue-types";

export type BookingStatus =
  | "PENDING"
  | "CONFIRMED"
  | "CANCELLED"
  | "REFUNDED"
  | "EXPIRED";

export interface AttendeeView {
  firstName: string;
  age: number | null;
}

export interface BookingView {
  reference: string;
  /** EXPIRED as soon as a hold runs out, whether or not the sweep has run. */
  status: BookingStatus;
  /** Places. For the kids class, children (ADR-016). */
  seats: number;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  /** When an unpaid hold lets its places go. Null unless PENDING. */
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
  nextCursor: string | null;
}

/** GET /sessions/:id/availability: the live count, never cached. */
export interface AvailabilityView {
  sessionId: string;
  status: "SCHEDULED" | "CANCELLED" | "COMPLETED";
  capacity: number;
  seatsLeft: number;
  isFull: boolean;
  onSale: boolean;
  checkedAt: string;
}
