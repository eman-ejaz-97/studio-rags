import type { DeliveryMode, ProductType, SessionStatus } from '@prisma/client';

/**
 * What the public catalogue returns. Built by hand from explicit selects, so a
 * column added to the schema later (or the Zoom link that is already there)
 * can never reach an anonymous caller by accident.
 */

export interface ImageView {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
}

export interface NextSessionView {
  id: string;
  startsAt: string;
  seatsLeft: number;
}

export interface WorkshopCard {
  slug: string;
  title: string;
  summary: string;
  productType: ProductType;
  deliveryMode: DeliveryMode;
  durationMinutes: number;
  priceCents: number;
  minAge: number | null;
  maxAge: number | null;
  /** Kids class: one ticket covers a child and their adult (ADR-016, ADR-033). */
  requiresAccompanyingAdult: boolean;
  heroImage: ImageView | null;
  /** The soonest session that still has a seat. Null when none is on sale. */
  nextSession: NextSessionView | null;
}

export interface CancellationTerms {
  cutoffBusinessDays: number;
  lateFeeCentsPerPerson: number;
  voucherValidityMonths: number;
}

export interface WorkshopDetail extends WorkshopCard {
  description: string;
  skillLevel: string | null;
  whatsIncluded: string | null;
  whatToBring: string | null;
  images: ImageView[];
  /** Null only if no default refund policy has been seeded. */
  cancellation: CancellationTerms | null;
}

export interface SessionView {
  id: string;
  startsAt: string;
  endsAt: string;
  priceCents: number;
  capacity: number;
  seatsLeft: number;
  isFull: boolean;
  /** Null for online sessions. The Zoom link is never part of this. */
  location: string | null;
}

export interface CalendarSessionView extends SessionView {
  workshop: {
    slug: string;
    title: string;
    productType: ProductType;
    deliveryMode: DeliveryMode;
  };
}

export interface AvailabilityView {
  sessionId: string;
  status: SessionStatus;
  capacity: number;
  seatsLeft: number;
  isFull: boolean;
  /** False once the session has started, been cancelled or completed. */
  onSale: boolean;
  checkedAt: string;
}
