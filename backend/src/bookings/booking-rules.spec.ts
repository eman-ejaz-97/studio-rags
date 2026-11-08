import { ProductType, SessionStatus } from '@prisma/client';
import {
  HOLD_MINUTES,
  ageRange,
  attendeeProblems,
  holdExpiry,
  isSameRequest,
  notOnSaleReason,
  priceSnapshot,
  takesAttendees,
} from './booking-rules';
import type { BookingRequest } from './bookings.types';

const now = new Date('2026-11-14T00:00:00.000Z');

const adults = { productType: ProductType.ONE_OFF, minAge: null, maxAge: null };
const kids = { productType: ProductType.KIDS, minAge: 7, maxAge: 15 };

describe('holdExpiry', () => {
  it('is 15 minutes after the hold is made', () => {
    expect(HOLD_MINUTES).toBe(15);
    expect(holdExpiry(now).toISOString()).toBe('2026-11-14T00:15:00.000Z');
  });
});

describe('priceSnapshot', () => {
  it('charges the unit price per place, with no discount yet', () => {
    expect(priceSnapshot(4200, 3)).toEqual({
      subtotalCents: 12600,
      discountCents: 0,
      totalCents: 12600,
    });
  });

  it('keeps a free session free', () => {
    expect(priceSnapshot(0, 2).totalCents).toBe(0);
  });
});

describe('notOnSaleReason', () => {
  const later = new Date(now.getTime() + 60_000);

  it('is null for a scheduled session that has not started', () => {
    expect(
      notOnSaleReason(
        { status: SessionStatus.SCHEDULED, startsAt: later },
        now,
      ),
    ).toBeNull();
  });

  it.each([
    [SessionStatus.CANCELLED, later, 'cancelled'],
    [SessionStatus.COMPLETED, later, 'completed'],
    [SessionStatus.SCHEDULED, now, 'started'],
    [SessionStatus.SCHEDULED, new Date(now.getTime() - 1), 'started'],
  ])('a %s session starting at %s: %s', (status, startsAt, reason) => {
    expect(notOnSaleReason({ status, startsAt }, now)).toBe(reason);
  });
});

describe('takesAttendees', () => {
  it.each([
    ['an adult class', adults, false],
    ['the kids class', kids, true],
    [
      'a kids class with no age limits set',
      { ...kids, minAge: null, maxAge: null },
      true,
    ],
    ['an adult class with a minimum age', { ...adults, minAge: 16 }, true],
  ])('%s: %s', (_, workshop, expected) => {
    expect(takesAttendees(workshop)).toBe(expected);
  });
});

describe('ageRange', () => {
  it.each([
    [7, 15, 'ages 7 to 15'],
    [7, null, 'ages 7 and over'],
    [null, 15, 'ages up to 15'],
    [null, null, 'all ages'],
  ])('min %p, max %p: %s', (minAge, maxAge, text) => {
    expect(ageRange({ productType: ProductType.KIDS, minAge, maxAge })).toBe(
      text,
    );
  });
});

describe('attendeeProblems', () => {
  it('accepts the edges of the age range', () => {
    expect(
      attendeeProblems(kids, {
        seats: 2,
        attendees: [
          { firstName: 'Sam', age: 7 },
          { firstName: 'Noor', age: 15 },
        ],
      }),
    ).toEqual([]);
  });

  it('accepts an adult class with no attendees', () => {
    expect(attendeeProblems(adults, { seats: 3, attendees: [] })).toEqual([]);
  });

  it('refuses attendees for a class that does not take them', () => {
    expect(
      attendeeProblems(adults, {
        seats: 1,
        attendees: [{ firstName: 'Sam', age: 30 }],
      }),
    ).toEqual(['This class does not take attendee details. Leave them out.']);
  });

  it.each([
    [2, 1, '2 places booked, 1 child listed.'],
    [1, 0, '1 place booked, 0 children listed.'],
    [1, 2, '1 place booked, 2 children listed.'],
  ])(
    'needs exactly one child per place: %i places, %i children',
    (seats, children, ending) => {
      const attendees = Array.from({ length: children }, () => ({
        firstName: 'Sam',
        age: 8,
      }));

      expect(attendeeProblems(kids, { seats, attendees })).toEqual([
        `Give a first name and age for each child: ${ending}`,
      ]);
    },
  );

  it('names each child that does not fit, by name where given', () => {
    expect(
      attendeeProblems(kids, {
        seats: 3,
        attendees: [
          { firstName: 'Sam', age: 6 },
          { firstName: '', age: 9 },
          { firstName: '', age: 16 },
        ],
      }),
    ).toEqual([
      'Sam is 6. This class is for ages 7 to 15.',
      'Enter the first name of child 2.',
      'Enter the first name of child 3.',
      'Child 3 is 16. This class is for ages 7 to 15.',
    ]);
  });
});

describe('isSameRequest', () => {
  const request: BookingRequest = {
    sessionId: 's1',
    seats: 2,
    attendees: [
      { firstName: 'Sam', age: 8 },
      { firstName: 'Noor', age: 9 },
    ],
    photoConsentOptOut: true,
    notes: 'Sam is allergic to latex',
  };
  const existing = {
    seats: 2,
    photoConsentOptOut: true,
    attendeeNotes: 'Sam is allergic to latex',
    attendees: [
      { firstName: 'Sam', age: 8 },
      { firstName: 'Noor', age: 9 },
    ],
  };

  it('is true for exactly the same request', () => {
    expect(isSameRequest(existing, request)).toBe(true);
  });

  it.each([
    ['more places', { seats: 3 }],
    ['a different photography answer', { photoConsentOptOut: false }],
    ['different notes', { notes: null }],
    ['a different child', { attendees: [request.attendees[0]] }],
    [
      'the children in another order',
      { attendees: [...request.attendees].reverse() },
    ],
    [
      'a different age',
      {
        attendees: [request.attendees[0], { firstName: 'Noor', age: 10 }],
      },
    ],
  ])('is false for %s', (_, change) => {
    expect(isSameRequest(existing, { ...request, ...change })).toBe(false);
  });
});
