import { HttpStatus, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProblemException } from '../common/filters/problem-details.filter';
import type { NotOnSaleReason } from './booking-rules';
import type { ConfirmOutcome } from './bookings.types';

/**
 * Problem types for refusals a client acts on (RFC 9457). Identifiers, not
 * pages: nothing is served at these paths.
 */
export const PROBLEM_TYPES = {
  sessionFull: '/problems/session-full',
  sessionNotOnSale: '/problems/session-not-on-sale',
  holdLapsed: '/problems/hold-lapsed',
  bookingCancelled: '/problems/booking-cancelled',
  paymentRequired: '/problems/payment-required',
} as const;

/** A missing session and a session of an unpublished class read the same. */
export const SESSION_NOT_FOUND = 'Session not found';

/** Someone else's booking reads the same as one that does not exist. */
export const BOOKING_NOT_FOUND = 'Booking not found';

/**
 * 409 when the places asked for are not there. `seatsLeft` is what this
 * customer could book right now: the places nobody holds, plus those held by
 * this customer's own earlier hold, which the new request would replace.
 */
export function sessionFull(
  seatsLeft: number,
  alreadyHeld = 0,
): ProblemException {
  return new ProblemException({
    type: PROBLEM_TYPES.sessionFull,
    title: 'Not enough places left',
    status: HttpStatus.CONFLICT,
    detail: fullDetail(seatsLeft, alreadyHeld),
    seatsLeft,
  });
}

function fullDetail(seatsLeft: number, alreadyHeld: number): string {
  if (seatsLeft === 0) return 'This class is fully booked.';
  const left =
    seatsLeft === 1
      ? 'Only 1 place is left'
      : `Only ${seatsLeft} places are left`;
  if (alreadyHeld === 0) return `${left} in this class.`;
  const held = alreadyHeld === 1 ? 'the place' : `the ${alreadyHeld} places`;
  return `${left} in this class, counting ${held} you are already holding.`;
}

const NOT_ON_SALE: Record<NotOnSaleReason, string> = {
  cancelled: 'This class date has been cancelled.',
  completed: 'This class date has already taken place.',
  started:
    'This class date has already started, so it can no longer be booked.',
};

export function sessionNotOnSale(reason: NotOnSaleReason): ProblemException {
  return new ProblemException({
    type: PROBLEM_TYPES.sessionNotOnSale,
    title: 'This date cannot be booked',
    status: HttpStatus.CONFLICT,
    detail: NOT_ON_SALE[reason],
    reason,
  });
}

/**
 * 409 when a hold ran out and its places have since gone to someone else.
 * A lapsed hold whose places are still free is confirmed instead (§ 10
 * item 33), so this only ever means the places are really gone.
 */
export function holdLapsed(): ProblemException {
  return new ProblemException({
    type: PROBLEM_TYPES.holdLapsed,
    title: 'Your hold has run out',
    status: HttpStatus.CONFLICT,
    detail:
      'Your hold ran out and those places have been taken. Please choose a date again.',
  });
}

/**
 * 409 for a booking that was cancelled or refunded, or a hold replaced by a
 * newer one when the customer changed their places (ADR-049).
 */
export function bookingCancelled(): ProblemException {
  return new ProblemException({
    type: PROBLEM_TYPES.bookingCancelled,
    title: 'This booking is no longer active',
    status: HttpStatus.CONFLICT,
    detail:
      'This booking was cancelled, or replaced when the places were changed, so it cannot be confirmed. Please check your bookings.',
  });
}

/**
 * 409 when this site confirms bookings by payment (PAYMENT_MODE=stripe), so
 * confirming without paying is not on offer.
 */
export function paymentRequired(): ProblemException {
  return new ProblemException({
    type: PROBLEM_TYPES.paymentRequired,
    title: 'Payment is needed',
    status: HttpStatus.CONFLICT,
    detail: 'This booking is confirmed once it is paid for.',
  });
}

/**
 * What a customer is told when confirmBooking refuses. not-found cannot
 * normally happen, since the caller has just found the booking, and reads
 * like every other missing booking.
 */
export function confirmRefusal(
  outcome: Extract<ConfirmOutcome, { kind: 'refused' }>,
): ProblemException | NotFoundException {
  switch (outcome.reason) {
    case 'no-seats':
      return holdLapsed();
    case 'cancelled':
      return bookingCancelled();
    case 'session-unavailable':
      return sessionNotOnSale(outcome.notOnSale);
    case 'not-found':
      return new NotFoundException(BOOKING_NOT_FOUND);
  }
}

/**
 * The name the capacity trigger puts at the start of its message (migration
 * 20261108120000_booking_capacity_backstop). Prisma passes a trigger's
 * message through but not its constraint name or, outside raw queries, its
 * SQLSTATE, so the message is what identifies it.
 */
export const CAPACITY_CONSTRAINT = 'bookings_session_capacity';

/** The database refused a write that would take a session over capacity. */
export function isCapacityRefusal(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientUnknownRequestError ||
      error instanceof Prisma.PrismaClientKnownRequestError) &&
    error.message.includes(CAPACITY_CONSTRAINT)
  );
}

/** Another booking already has the reference just drawn. */
export function isReferenceClash(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target)
    ? target.includes('reference')
    : typeof target === 'string' && target.includes('reference');
}
