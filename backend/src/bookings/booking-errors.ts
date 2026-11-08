import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProblemException } from '../common/filters/problem-details.filter';
import type { NotOnSaleReason } from './booking-rules';

/**
 * Problem types for refusals a client acts on (RFC 9457). Identifiers, not
 * pages: nothing is served at these paths.
 */
export const PROBLEM_TYPES = {
  sessionFull: '/problems/session-full',
  sessionNotOnSale: '/problems/session-not-on-sale',
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
