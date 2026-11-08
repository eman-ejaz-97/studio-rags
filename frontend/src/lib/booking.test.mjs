import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_PLACES,
  ageRange,
  bookPath,
  bookingPath,
  childField,
  clockOffset,
  draftFromBooking,
  fieldOrder,
  groupBookings,
  holdMilestone,
  holdTimeLeft,
  isLiveHold,
  milestoneMessage,
  nextBooked,
  placesLimit,
  refusalOf,
  statusLabel,
  takesAttendees,
  toBookingRequest,
  validateDraft,
} from "./booking.ts";

const studio = { productType: "ONE_OFF", minAge: null, maxAge: null };
const kids = { productType: "KIDS", minAge: 7, maxAge: 15 };

const draft = (over = {}) => ({ seats: 1, children: [], photo: "in", notes: "", ...over });

const NOW = Date.parse("2026-11-08T00:00:00.000Z");
const minutes = (n) => n * 60_000;

/** A booking as the API sends it, with only what a test cares about changed. */
function booking(over = {}) {
  const { session, ...rest } = over;
  return {
    reference: "SR-AAAAA",
    status: "CONFIRMED",
    seats: 1,
    subtotalCents: 8200,
    discountCents: 0,
    totalCents: 8200,
    holdExpiresAt: null,
    photoConsentOptOut: false,
    notes: null,
    attendees: [],
    confirmedAt: "2026-11-01T00:00:00.000Z",
    cancelledAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...rest,
    session: {
      id: "s1",
      startsAt: "2026-11-14T23:30:00.000Z",
      endsAt: "2026-11-15T02:30:00.000Z",
      location: "Studio Rags, Sefton Park SA",
      onlineJoinUrl: null,
      workshop: {
        slug: "batik-workshop",
        title: "Indonesian Batik Workshop",
        productType: "ONE_OFF",
        deliveryMode: "IN_PERSON",
        requiresAccompanyingAdult: false,
      },
      ...session,
    },
  };
}

describe("which classes name their attendees", () => {
  it("asks for children at the kids class and any class with an age limit", () => {
    assert.equal(takesAttendees(kids), true);
    assert.equal(takesAttendees({ ...studio, minAge: 12 }), true);
    assert.equal(takesAttendees(studio), false);
  });

  it("says the age range the way the API does", () => {
    assert.equal(ageRange(kids), "ages 7 to 15");
    assert.equal(ageRange({ ...studio, minAge: 12 }), "ages 12 and over");
    assert.equal(ageRange({ ...studio, maxAge: 15 }), "ages up to 15");
  });
});

describe("placesLimit", () => {
  it("is the places left, up to 8 (ADR-051)", () => {
    assert.equal(placesLimit(5), 5);
    assert.equal(placesLimit(12), MAX_PLACES);
    assert.equal(placesLimit(0), 0);
  });

  it("counts places this customer already holds, since a change replaces that hold", () => {
    assert.equal(placesLimit(1, 2), 3);
  });
});

describe("validateDraft", () => {
  it("passes a complete studio booking", () => {
    assert.deepEqual(validateDraft(draft({ seats: 2 }), { ...studio, placesLeft: 5 }), {});
  });

  it("insists on an answer to the photography question, with no default (ADR-018)", () => {
    const errors = validateDraft(draft({ photo: null }), { ...studio, placesLeft: 5 });
    assert.equal(errors.photo, "Choose whether you’re happy to be in photos");
  });

  it("sends a big group to Rehana rather than past the limit", () => {
    const errors = validateDraft(draft({ seats: 9 }), { ...studio, placesLeft: 12 });
    assert.match(errors.seats, /up to 8 places\. For a bigger group, send Rehana a message/);
  });

  it("says how many places are left when fewer than asked", () => {
    assert.equal(
      validateDraft(draft({ seats: 3 }), { ...studio, placesLeft: 2 }).seats,
      "Only 2 places are left on this date",
    );
    assert.equal(
      validateDraft(draft({ seats: 2 }), { ...studio, placesLeft: 1 }).seats,
      "Only 1 place is left on this date",
    );
  });

  it("checks each child's name and age against the class's range", () => {
    const errors = validateDraft(
      draft({
        seats: 3,
        children: [
          { firstName: "Sam", age: "5" },
          { firstName: "", age: "" },
          { firstName: "Noor", age: "nine" },
        ],
      }),
      { ...kids, placesLeft: 6 },
    );
    assert.deepEqual(errors, {
      [childField(0, "age")]: "Sam is 5. This class is for ages 7 to 15.",
      [childField(1, "firstName")]: "Enter the first name of child 2",
      [childField(1, "age")]: "Enter child 2’s age",
      [childField(2, "age")]: "Enter the age in whole years, like 9",
    });
  });

  it("only checks the children being booked, not ones kept from a larger number", () => {
    const errors = validateDraft(
      draft({ seats: 1, children: [{ firstName: "Sam", age: "8" }, { firstName: "", age: "" }] }),
      { ...kids, placesLeft: 6 },
    );
    assert.deepEqual(errors, {});
  });

  it("names an older child too", () => {
    const errors = validateDraft(
      draft({ children: [{ firstName: "James", age: "16" }] }),
      { ...kids, placesLeft: 6 },
    );
    assert.equal(errors[childField(0, "age")], "James is 16. This class is for ages 7 to 15.");
  });

  it("keeps notes to 500 characters", () => {
    const errors = validateDraft(draft({ notes: "x".repeat(501) }), { ...studio, placesLeft: 5 });
    assert.equal(errors.notes, "Keep notes to 500 characters");
  });
});

describe("fieldOrder", () => {
  it("lists the fields top to bottom, children included", () => {
    assert.deepEqual(fieldOrder(draft({ seats: 2 }), true), [
      "seats",
      "child-0-firstName",
      "child-0-age",
      "child-1-firstName",
      "child-1-age",
      "photo",
      "notes",
    ]);
    assert.deepEqual(fieldOrder(draft(), false), ["seats", "photo", "notes"]);
  });
});

describe("toBookingRequest", () => {
  it("sends trimmed children as numbers, and the photo answer as the opt-out flag", () => {
    const body = toBookingRequest(
      "s1",
      draft({
        seats: 1,
        children: [{ firstName: " Sam ", age: " 8" }, { firstName: "Extra", age: "9" }],
        photo: "out",
        notes: "  Sam is left-handed  ",
      }),
      true,
    );
    assert.deepEqual(body, {
      sessionId: "s1",
      seats: 1,
      attendees: [{ firstName: "Sam", age: 8 }],
      photoConsentOptOut: true,
      notes: "Sam is left-handed",
    });
  });

  it("leaves out attendees for a class without them, and blank notes", () => {
    assert.deepEqual(toBookingRequest("s1", draft({ seats: 2, notes: "  " }), false), {
      sessionId: "s1",
      seats: 2,
      photoConsentOptOut: false,
    });
  });
});

describe("draftFromBooking", () => {
  it("brings back every answer, so starting again keeps them", () => {
    const b = booking({
      seats: 2,
      attendees: [
        { firstName: "Sam", age: 8 },
        { firstName: "Noor", age: 11 },
      ],
      photoConsentOptOut: true,
      notes: "Sam is left-handed",
    });
    assert.deepEqual(draftFromBooking(b), {
      seats: 2,
      children: [
        { firstName: "Sam", age: "8" },
        { firstName: "Noor", age: "11" },
      ],
      photo: "out",
      notes: "Sam is left-handed",
    });
  });
});

describe("the hold countdown", () => {
  it("speaks in whole minutes, rounded down", () => {
    assert.equal(holdTimeLeft(minutes(15)), "15 minutes left");
    assert.equal(holdTimeLeft(minutes(14) + 59_000), "14 minutes left");
    assert.equal(holdTimeLeft(minutes(1) + 30_000), "1 minute left");
    assert.equal(holdTimeLeft(45_000), "Less than a minute left");
    assert.equal(holdTimeLeft(0), "Time’s up");
  });

  it("marks only the moments worth announcing", () => {
    assert.equal(holdMilestone(minutes(6)), "plenty");
    assert.equal(holdMilestone(minutes(5)), "five");
    assert.equal(holdMilestone(minutes(1)), "one");
    assert.equal(holdMilestone(-1), "over");
    assert.equal(milestoneMessage("plenty"), null);
    assert.equal(milestoneMessage("five"), "Less than 5 minutes left to confirm your booking.");
    assert.equal(milestoneMessage("one"), "Less than a minute left to confirm your booking.");
    assert.equal(milestoneMessage("over"), null);
  });

  it("allows for a device clock that is out, but ignores the header's rounding", () => {
    const received = Date.parse("2026-11-08T00:00:00.500Z");
    assert.equal(clockOffset("Sun, 08 Nov 2026 00:03:00 GMT", received), 179_500);
    assert.equal(clockOffset("Sun, 08 Nov 2026 00:00:01 GMT", received), 0);
    assert.equal(clockOffset(null, received), 0);
    assert.equal(clockOffset("not a date", received), 0);
  });
});

describe("groupBookings", () => {
  const hold = booking({
    reference: "SR-HOLD1",
    status: "PENDING",
    confirmedAt: null,
    holdExpiresAt: new Date(NOW + minutes(10)).toISOString(),
    session: { startsAt: "2026-11-20T23:30:00.000Z", endsAt: "2026-11-21T02:30:00.000Z" },
  });
  const later = booking({
    reference: "SR-LATER",
    session: { startsAt: "2026-12-05T23:30:00.000Z", endsAt: "2026-12-06T02:30:00.000Z" },
  });
  const soon = booking({ reference: "SR-SOON1" });
  const finished = booking({
    reference: "SR-DONE1",
    session: { startsAt: "2026-10-03T23:30:00.000Z", endsAt: "2026-10-04T02:30:00.000Z" },
  });
  const cancelled = booking({
    reference: "SR-CANC1",
    status: "CANCELLED",
    cancelledAt: "2026-11-02T00:00:00.000Z",
    session: { startsAt: "2026-12-12T23:30:00.000Z", endsAt: "2026-12-13T02:30:00.000Z" },
  });
  const lapsed = booking({
    reference: "SR-LAPS1",
    status: "PENDING",
    confirmedAt: null,
    holdExpiresAt: new Date(NOW - 1).toISOString(),
  });

  it("puts booked and held classes first, soonest first", () => {
    const { upcoming } = groupBookings([later, hold, finished, soon, cancelled, lapsed], NOW);
    assert.deepEqual(
      upcoming.map((b) => b.reference),
      ["SR-SOON1", "SR-HOLD1", "SR-LATER"],
    );
  });

  it("puts finished and cancelled bookings after, latest first, and drops lapsed holds", () => {
    const { past } = groupBookings([later, hold, finished, soon, cancelled, lapsed], NOW);
    assert.deepEqual(
      past.map((b) => b.reference),
      ["SR-CANC1", "SR-DONE1"],
    );
  });

  it("finds the next booked class for the home page, never a hold", () => {
    assert.equal(nextBooked([later, hold, soon], NOW)?.reference, "SR-SOON1");
    assert.equal(nextBooked([hold, finished], NOW), null);
  });

  it("labels each booking in words", () => {
    assert.equal(statusLabel(hold, NOW), "Not booked yet");
    assert.equal(statusLabel(soon, NOW), "Booked");
    assert.equal(statusLabel(finished, NOW), null);
    assert.equal(statusLabel(cancelled, NOW), "Cancelled");
    assert.equal(statusLabel(lapsed, NOW), "Hold ran out");
    assert.equal(isLiveHold(hold, NOW), true);
    assert.equal(isLiveHold(lapsed, NOW), false);
  });
});

describe("refusalOf", () => {
  it("recognises the API's problem types, relative or absolute", () => {
    assert.equal(refusalOf({ type: "/problems/session-full", seatsLeft: 2 }), "session-full");
    assert.equal(refusalOf({ type: "/problems/hold-lapsed" }), "hold-lapsed");
    assert.equal(
      refusalOf({ type: "https://studio-rags.vercel.app/problems/payment-required" }),
      "payment-required",
    );
  });

  it("returns null for anything else", () => {
    assert.equal(refusalOf({ type: "/problems/something-new" }), null);
    assert.equal(refusalOf({ message: "Booking not found" }), null);
    assert.equal(refusalOf(null), null);
  });
});

describe("addresses", () => {
  it("builds the booking pages' paths, escaping what came from data", () => {
    assert.equal(bookingPath("SR-7K4M2"), "/bookings/SR-7K4M2");
    assert.equal(bookPath("batik-workshop", "s1"), "/classes/batik-workshop/book/s1");
    assert.equal(
      bookPath("batik-workshop", "s1", "SR-7K4M2"),
      "/classes/batik-workshop/book/s1?from=SR-7K4M2",
    );
  });
});
