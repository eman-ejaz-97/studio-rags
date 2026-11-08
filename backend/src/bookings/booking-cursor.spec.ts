import { BadRequestException } from '@nestjs/common';
import {
  INVALID_CURSOR,
  decodeCursor,
  encodeCursor,
  olderThan,
} from './booking-cursor';

const row = {
  createdAt: new Date('2026-11-08T03:14:15.926Z'),
  id: 'cmw7bm3ol00030synt17p2nve',
};

describe('booking cursors', () => {
  it('round-trips the last row’s time and id, to the millisecond', () => {
    expect(decodeCursor(encodeCursor(row))).toEqual(row);
  });

  it('is URL-safe, so it can go in a query string as it is', () => {
    expect(encodeCursor(row)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it.each([
    ['not base64 JSON', 'not-a-cursor'],
    ['an object', Buffer.from('{"id":"x"}').toString('base64url')],
    ['a bad date', Buffer.from('["yesterday","abc"]').toString('base64url')],
    [
      'an id with SQL in it',
      Buffer.from('["2026-11-08T00:00:00.000Z","x\' OR 1=1"]').toString(
        'base64url',
      ),
    ],
  ])('refuses %s with a 400', (_, cursor) => {
    expect(() => decodeCursor(cursor)).toThrow(
      new BadRequestException(INVALID_CURSOR),
    );
  });

  it('continues strictly after the cursor, the id breaking ties in time', () => {
    expect(olderThan(row)).toEqual({
      OR: [
        { createdAt: { lt: row.createdAt } },
        { createdAt: row.createdAt, id: { lt: row.id } },
      ],
    });
  });
});
