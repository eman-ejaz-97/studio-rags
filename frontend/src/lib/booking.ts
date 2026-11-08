/**
 * The booking screens' rules, kept apart from React so booking.test.mjs can
 * check them directly. No runtime imports, for the same reason: node runs the
 * test against this file as it stands.
 *
 * The limits mirror the API's (backend/src/bookings/booking-rules.ts and
 * dto/create-booking.dto.ts), so most mistakes are caught on the page in the
 * same words the API would use. The API still checks everything.
 */

import type { BookingView } from "./booking-types";
import type { ProductType } from "./catalogue-types";

/** The most places one booking can take (ADR-051). Bigger groups ask Rehana. */
export const MAX_PLACES = 8;
/** A child's first name, as the API allows it. */
export const NAME_MAX = 60;
export const NOTES_MAX = 500;
/** How long the API holds places (SPEC § 5, FR-A5). For words on the page. */
export const HOLD_MINUTES = 15;

export interface AgeRule {
  productType: ProductType;
  minAge: number | null;
  maxAge: number | null;
}

/**
 * Whether the class names its attendees: the kids class, and any class with
 * an age limit, because the ages are checked when booking, not at the door.
 */
export function takesAttendees(rule: AgeRule): boolean {
  return rule.productType === "KIDS" || rule.minAge !== null || rule.maxAge !== null;
}

/** "ages 7 to 15", "ages 7 and over", "ages up to 15". */
export function ageRange({ minAge, maxAge }: AgeRule): string {
  if (minAge !== null && maxAge !== null) return `ages ${minAge} to ${maxAge}`;
  if (minAge !== null) return `ages ${minAge} and over`;
  if (maxAge !== null) return `ages up to ${maxAge}`;
  return "all ages";
}

/**
 * The most places this customer can choose: what is left on the date, plus
 * any they already hold on it, since a changed request replaces their own
 * hold (ADR-049). Never more than MAX_PLACES.
 */
export function placesLimit(seatsLeft: number, alreadyHeld = 0): number {
  return Math.max(0, Math.min(MAX_PLACES, seatsLeft + alreadyHeld));
}

// ─── The form ───────────────────────────────────────────────────────────────

/** The photography question has no default: the customer must answer it (ADR-018). */
export type PhotoChoice = "in" | "out";

export interface ChildDraft {
  firstName: string;
  /** As typed, so a half-typed age is not lost or reformatted. */
  age: string;
}

export interface BookingDraft {
  seats: number;
  /** Can be longer than `seats`: going from 3 children to 2 and back keeps the third. */
  children: ChildDraft[];
  photo: PhotoChoice | null;
  notes: string;
}

export type DraftErrors = Partial<Record<string, string>>;

export function childField(index: number, field: "firstName" | "age"): string {
  return `child-${index}-${field}`;
}

/** Every field the form can show, in page order, for focusing the first mistake. */
export function fieldOrder(draft: BookingDraft, withChildren: boolean): string[] {
  const children = withChildren
    ? Array.from({ length: draft.seats }, (_, i) => [
        childField(i, "firstName"),
        childField(i, "age"),
      ]).flat()
    : [];
  return ["seats", ...children, "photo", "notes"];
}

const WHOLE_NUMBER = /^\d{1,3}$/;

/**
 * Every mistake in the form, keyed by field, in words for the customer.
 * `placesLeft` already includes any places this customer holds on the date.
 */
export function validateDraft(
  draft: BookingDraft,
  rule: AgeRule & { placesLeft: number },
): DraftErrors {
  const errors: DraftErrors = {};

  if (draft.seats < 1) {
    errors.seats = "Choose at least one place";
  } else if (draft.seats > MAX_PLACES) {
    errors.seats = `One booking can take up to ${MAX_PLACES} places. For a bigger group, send Rehana a message.`;
  } else if (draft.seats > rule.placesLeft) {
    errors.seats =
      rule.placesLeft === 1
        ? "Only 1 place is left on this date"
        : `Only ${rule.placesLeft} places are left on this date`;
  }

  if (takesAttendees(rule)) {
    draft.children.slice(0, draft.seats).forEach((child, i) => {
      const name = child.firstName.trim();
      const label = name || `child ${i + 1}`;
      if (!name) errors[childField(i, "firstName")] = `Enter the first name of child ${i + 1}`;
      else if (name.length > NAME_MAX) {
        errors[childField(i, "firstName")] = `Use at most ${NAME_MAX} characters`;
      }

      const typed = child.age.trim();
      if (!typed) {
        errors[childField(i, "age")] = `Enter ${possessive(label)} age`;
      } else if (!WHOLE_NUMBER.test(typed)) {
        errors[childField(i, "age")] = "Enter the age in whole years, like 9";
      } else {
        const age = Number(typed);
        const tooYoung = rule.minAge !== null && age < rule.minAge;
        const tooOld = rule.maxAge !== null && age > rule.maxAge;
        if (tooYoung || tooOld) {
          errors[childField(i, "age")] =
            `${capitalise(label)} is ${age}. This class is for ${ageRange(rule)}.`;
        }
      }
    });
  }

  if (draft.photo === null) {
    errors.photo = "Choose whether you’re happy to be in photos";
  }
  if (draft.notes.trim().length > NOTES_MAX) {
    errors.notes = `Keep notes to ${NOTES_MAX} characters`;
  }
  return errors;
}

function possessive(name: string): string {
  return name.endsWith("s") ? `${name}’` : `${name}’s`;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The body for POST /bookings, from a draft that has passed validateDraft. */
export function toBookingRequest(
  sessionId: string,
  draft: BookingDraft,
  withChildren: boolean,
) {
  const notes = draft.notes.trim();
  return {
    sessionId,
    seats: draft.seats,
    ...(withChildren
      ? {
          attendees: draft.children.slice(0, draft.seats).map((c) => ({
            firstName: c.firstName.trim(),
            age: Number(c.age.trim()),
          })),
        }
      : {}),
    photoConsentOptOut: draft.photo === "out",
    ...(notes ? { notes } : {}),
  };
}

/** A booking's answers back as a draft, so "Change" and "Start again" keep them. */
export function draftFromBooking(booking: BookingView): BookingDraft {
  return {
    seats: booking.seats,
    children: booking.attendees.map((a) => ({
      firstName: a.firstName,
      age: a.age === null ? "" : String(a.age),
    })),
    photo: booking.photoConsentOptOut ? "out" : "in",
    notes: booking.notes ?? "",
  };
}

// ─── The hold ───────────────────────────────────────────────────────────────

/**
 * How long is left on a hold, in words that change once a minute. Rounded
 * down, so the page never promises more time than there is.
 */
export function holdTimeLeft(msLeft: number): string {
  if (msLeft <= 0) return "Time’s up";
  if (msLeft < 60_000) return "Less than a minute left";
  const minutes = Math.floor(msLeft / 60_000);
  return minutes === 1 ? "1 minute left" : `${minutes} minutes left`;
}

/**
 * The moments worth telling a screen reader about: five minutes left, one
 * minute left, and time up. Announcing every tick would drown the page out.
 */
export type HoldMilestone = "plenty" | "five" | "one" | "over";

export function holdMilestone(msLeft: number): HoldMilestone {
  if (msLeft <= 0) return "over";
  if (msLeft <= 60_000) return "one";
  if (msLeft <= 5 * 60_000) return "five";
  return "plenty";
}

/**
 * What a live region says for each milestone. Worded to stay true for the
 * whole stretch it covers, since it is on the page, not only announced.
 */
export function milestoneMessage(milestone: HoldMilestone): string | null {
  if (milestone === "five") return "Less than 5 minutes left to confirm your booking.";
  if (milestone === "one") return "Less than a minute left to confirm your booking.";
  return null;
}

/**
 * How far the API's clock is ahead of this device's, from the response's Date
 * header, so a phone set a few minutes out still counts down to the API's
 * expiry. The header is to the second, so under two seconds is noise.
 */
export function clockOffset(dateHeader: string | null, receivedAt: number): number {
  const server = dateHeader ? Date.parse(dateHeader) : Number.NaN;
  if (Number.isNaN(server)) return 0;
  const offset = server - receivedAt;
  return Math.abs(offset) < 2_000 ? 0 : offset;
}

// ─── Lists ──────────────────────────────────────────────────────────────────

/** A hold with time left on it at `now`. */
export function isLiveHold(booking: BookingView, now: number): boolean {
  return (
    booking.status === "PENDING" &&
    booking.holdExpiresAt !== null &&
    Date.parse(booking.holdExpiresAt) > now
  );
}

/**
 * The account page's two lists. Upcoming: booked or held, for a class that
 * has not finished, soonest first. Past and cancelled: the rest, latest
 * first. A hold that ran out was never a booking, so it is left out, as the
 * API leaves it out of the list.
 */
export function groupBookings(
  bookings: BookingView[],
  now: number,
): { upcoming: BookingView[]; past: BookingView[] } {
  const upcoming: BookingView[] = [];
  const past: BookingView[] = [];
  for (const b of bookings) {
    const live = b.status === "CONFIRMED" || isLiveHold(b, now);
    if (live && Date.parse(b.session.endsAt) > now) upcoming.push(b);
    else if (b.confirmedAt !== null) past.push(b);
  }
  const start = (b: BookingView) => Date.parse(b.session.startsAt);
  upcoming.sort((a, b) => start(a) - start(b));
  past.sort((a, b) => start(b) - start(a));
  return { upcoming, past };
}

/** The soonest booked class that has not started, for the home page. */
export function nextBooked(bookings: BookingView[], now: number): BookingView | null {
  return (
    bookings
      .filter((b) => b.status === "CONFIRMED" && Date.parse(b.session.startsAt) > now)
      .sort((a, b) => Date.parse(a.session.startsAt) - Date.parse(b.session.startsAt))[0] ??
    null
  );
}

/** The word on a booking's chip, or null when the date says enough. */
export function statusLabel(booking: BookingView, now: number): string | null {
  switch (booking.status) {
    case "PENDING":
      return isLiveHold(booking, now) ? "Not booked yet" : "Hold ran out";
    case "EXPIRED":
      return "Hold ran out";
    case "CANCELLED":
      return "Cancelled";
    case "REFUNDED":
      return "Refunded";
    case "CONFIRMED":
      return Date.parse(booking.session.endsAt) > now ? "Booked" : null;
  }
}

// ─── Refusals ───────────────────────────────────────────────────────────────

/** The API's 409 problem types this flow acts on. */
export type Refusal =
  | "session-full"
  | "session-not-on-sale"
  | "hold-lapsed"
  | "booking-cancelled"
  | "payment-required";

const REFUSALS: Refusal[] = [
  "session-full",
  "session-not-on-sale",
  "hold-lapsed",
  "booking-cancelled",
  "payment-required",
];

/**
 * Which refusal a problem+json body is. Matched on the end of `type`, so the
 * relative "/problems/…" used today and a full URI later both work.
 */
export function refusalOf(body: unknown): Refusal | null {
  const type = (body as { type?: unknown } | null)?.type;
  if (typeof type !== "string") return null;
  return REFUSALS.find((r) => type.endsWith(`/problems/${r}`)) ?? null;
}

// ─── Addresses ──────────────────────────────────────────────────────────────

export function bookingPath(reference: string): string {
  return `/bookings/${encodeURIComponent(reference)}`;
}

/** The booking form for a date; `from` carries an earlier booking's answers. */
export function bookPath(slug: string, sessionId: string, from?: string): string {
  const path = `/classes/${encodeURIComponent(slug)}/book/${encodeURIComponent(sessionId)}`;
  return from ? `${path}?from=${encodeURIComponent(from)}` : path;
}
