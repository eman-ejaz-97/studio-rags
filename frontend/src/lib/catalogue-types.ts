/**
 * The public catalogue as the API returns it (backend/src/catalogue/
 * catalogue.types.ts). Kept in step by hand for now; the e2e suite on the API
 * side pins the shapes.
 */

export type ProductType = "ONE_OFF" | "ONLINE" | "KIDS";
export type DeliveryMode = "IN_PERSON" | "ONLINE";

export interface ImageView {
  url: string;
  alt: string;
  width: number | null;
  height: number | null;
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
  requiresAccompanyingAdult: boolean;
  heroImage: ImageView | null;
  nextSession: { id: string; startsAt: string; seatsLeft: number } | null;
}

export interface WorkshopDetail extends WorkshopCard {
  description: string;
  skillLevel: string | null;
  whatsIncluded: string | null;
  whatToBring: string | null;
  images: ImageView[];
  cancellation: {
    cutoffBusinessDays: number;
    lateFeeCentsPerPerson: number;
    voucherValidityMonths: number;
  } | null;
}

export interface SessionView {
  id: string;
  startsAt: string;
  endsAt: string;
  priceCents: number;
  capacity: number;
  seatsLeft: number;
  isFull: boolean;
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

/** The three ways the site groups classes, as used in ?type= links. */
export const CLASS_TYPES = {
  studio: { label: "In the studio", productType: "ONE_OFF" },
  online: { label: "Online", productType: "ONLINE" },
  kids: { label: "Kids & parents", productType: "KIDS" },
} as const satisfies Record<string, { label: string; productType: ProductType }>;

export type ClassType = keyof typeof CLASS_TYPES;

export function parseClassType(value: string | undefined): ClassType | null {
  return value && value in CLASS_TYPES ? (value as ClassType) : null;
}
