import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Where a page of bookings ended: the last row's creation time and id. The
 * id breaks ties between bookings made in the same millisecond, so no row is
 * skipped or shown twice across pages, and a booking made while someone is
 * paging lands on page one rather than shifting the pages after it.
 */
export interface BookingCursor {
  createdAt: Date;
  id: string;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

export const INVALID_CURSOR = 'cursor is not valid';

/** Opaque to clients: they pass back what they were given. */
export function encodeCursor(row: BookingCursor): string {
  return Buffer.from(
    JSON.stringify([row.createdAt.toISOString(), row.id]),
  ).toString('base64url');
}

/** Throws a 400 for anything this API did not issue. */
export function decodeCursor(cursor: string): BookingCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new BadRequestException(INVALID_CURSOR);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string' ||
    !ID.test(parsed[1])
  ) {
    throw new BadRequestException(INVALID_CURSOR);
  }
  const createdAt = new Date(parsed[0]);
  if (Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException(INVALID_CURSOR);
  }
  return { createdAt, id: parsed[1] };
}

/** Rows after the cursor in newest-first order (createdAt desc, id desc). */
export function olderThan(cursor: BookingCursor): Prisma.BookingWhereInput {
  return {
    OR: [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ],
  };
}
