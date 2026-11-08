import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProblemException } from '../common/filters/problem-details.filter';
import {
  bookingCancelled,
  confirmRefusal,
  holdLapsed,
  isCapacityRefusal,
  isReferenceClash,
  paymentRequired,
  sessionFull,
  sessionNotOnSale,
} from './booking-errors';

const clientVersion = '6.19.3';

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('failed', {
    code,
    clientVersion,
    meta,
  });

describe('sessionFull', () => {
  it.each([
    [0, 0, 'This class is fully booked.'],
    [1, 0, 'Only 1 place is left in this class.'],
    [3, 0, 'Only 3 places are left in this class.'],
    [
      3,
      1,
      'Only 3 places are left in this class, counting the place you are already holding.',
    ],
    [
      4,
      2,
      'Only 4 places are left in this class, counting the 2 places you are already holding.',
    ],
  ])('%i left, %i already held: %s', (left, held, detail) => {
    expect(sessionFull(left, held).getResponse()).toEqual({
      type: '/problems/session-full',
      title: 'Not enough places left',
      status: 409,
      detail,
      seatsLeft: left,
      statusCode: 409,
      message: detail,
    });
  });
});

describe('sessionNotOnSale', () => {
  it('is a 409 problem that says why', () => {
    expect(sessionNotOnSale('cancelled').getResponse()).toMatchObject({
      type: '/problems/session-not-on-sale',
      status: 409,
      detail: 'This class date has been cancelled.',
      reason: 'cancelled',
    });
  });
});

describe('the confirm refusals', () => {
  it.each([
    [
      'holdLapsed',
      holdLapsed,
      '/problems/hold-lapsed',
      'Your hold has run out',
      'Your hold ran out and those places have been taken. Please choose a date again.',
    ],
    [
      'bookingCancelled',
      bookingCancelled,
      '/problems/booking-cancelled',
      'This booking is no longer active',
      'This booking was cancelled, or replaced when the places were changed, so it cannot be confirmed. Please check your bookings.',
    ],
    [
      'paymentRequired',
      paymentRequired,
      '/problems/payment-required',
      'Payment is needed',
      'This booking is confirmed once it is paid for.',
    ],
  ])(
    '%s is a 409 problem in words, with the fields every other error has',
    (_, make, type, title, detail) => {
      const problem = make();

      expect(problem.getStatus()).toBe(409);
      expect(problem.getResponse()).toEqual({
        type,
        title,
        status: 409,
        detail,
        statusCode: 409,
        message: detail,
      });
    },
  );
});

describe('confirmRefusal', () => {
  const refused = { kind: 'refused', bookingId: 'booking_1' } as const;

  it.each([
    ['no-seats', '/problems/hold-lapsed'],
    ['cancelled', '/problems/booking-cancelled'],
  ] as const)('answers %s with %s', (reason, type) => {
    const error = confirmRefusal({ ...refused, reason });

    expect(error).toBeInstanceOf(ProblemException);
    expect(error.getResponse()).toMatchObject({ type, status: 409 });
  });

  it.each(['cancelled', 'completed', 'started'] as const)(
    'answers a session that is %s as not on sale, saying why',
    (notOnSale) => {
      const error = confirmRefusal({
        ...refused,
        reason: 'session-unavailable',
        notOnSale,
      });

      expect(error.getResponse()).toEqual(
        sessionNotOnSale(notOnSale).getResponse(),
      );
    },
  );

  it('answers a booking that vanished as missing, like any other', () => {
    expect(confirmRefusal({ ...refused, reason: 'not-found' })).toEqual(
      new NotFoundException('Booking not found'),
    );
  });
});

describe('isCapacityRefusal', () => {
  it('recognises the trigger’s refusal from a model query', () => {
    const error = new Prisma.PrismaClientUnknownRequestError(
      'PostgresError { code: "23514", message: "bookings_session_capacity: session s1 would be overbooked, 3 seats taken of 2" }',
      { clientVersion },
    );

    expect(isCapacityRefusal(error)).toBe(true);
  });

  it('recognises it from a raw query', () => {
    const error = new Prisma.PrismaClientKnownRequestError(
      'Raw query failed. Code: `23514`. Message: `ERROR: bookings_session_capacity: session s1 would be overbooked`',
      { code: 'P2010', clientVersion },
    );

    expect(isCapacityRefusal(error)).toBe(true);
  });

  it.each([
    ['another check failing', known('P2010')],
    [
      'a plain error mentioning the name',
      new Error('bookings_session_capacity'),
    ],
    ['nothing', undefined],
  ])('ignores %s', (_, error) => {
    expect(isCapacityRefusal(error)).toBe(false);
  });
});

describe('isReferenceClash', () => {
  it.each([
    ['a list target', known('P2002', { target: ['reference'] })],
    [
      'a constraint-name target',
      known('P2002', { target: 'bookings_reference_key' }),
    ],
  ])('recognises a clash with %s', (_, error) => {
    expect(isReferenceClash(error)).toBe(true);
  });

  it.each([
    ['a clash on another column', known('P2002', { target: ['email'] })],
    ['another error code', known('P2003', { target: ['reference'] })],
    ['a plain error', new Error('reference')],
  ])('ignores %s', (_, error) => {
    expect(isReferenceClash(error)).toBe(false);
  });
});
