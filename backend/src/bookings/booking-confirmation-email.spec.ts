import { DeliveryMode } from '@prisma/client';
import {
  type ConfirmationEmailRow,
  toConfirmationEmail,
} from './booking-confirmation-email';

const row = (
  overrides: Partial<ConfirmationEmailRow['session']['workshop']> = {},
): ConfirmationEmailRow => ({
  id: 'booking_1',
  reference: 'SR-7K4M2',
  seats: 2,
  totalCents: 8400,
  user: { email: 'ada@example.com', firstName: 'Ada' },
  session: {
    startsAt: new Date('2026-11-21T00:00:00.000Z'),
    endsAt: new Date('2026-11-21T02:00:00.000Z'),
    location: null,
    onlineJoinUrl: 'https://zoom.us/j/1234567890',
    workshop: {
      title: 'Kids & Parents',
      deliveryMode: DeliveryMode.ONLINE,
      requiresAccompanyingAdult: true,
      whatToBring: 'An apron\nOld clothes',
      ...overrides,
    },
  },
});

describe('toConfirmationEmail', () => {
  it('addresses the customer and carries everything the template shows, with the booking id for email_logs', () => {
    expect(toConfirmationEmail(row(), { paid: false })).toEqual({
      to: 'ada@example.com',
      bookingId: 'booking_1',
      paid: false,
      firstName: 'Ada',
      reference: 'SR-7K4M2',
      workshopTitle: 'Kids & Parents',
      startsAt: new Date('2026-11-21T00:00:00.000Z'),
      endsAt: new Date('2026-11-21T02:00:00.000Z'),
      deliveryMode: DeliveryMode.ONLINE,
      location: null,
      onlineJoinUrl: 'https://zoom.us/j/1234567890',
      seats: 2,
      requiresAccompanyingAdult: true,
      totalCents: 8400,
      whatToBring: 'An apron\nOld clothes',
    });
  });

  it.each([true, false])(
    'passes whether payment was taken (%s) exactly as the caller says',
    (paid) => {
      expect(toConfirmationEmail(row(), { paid }).paid).toBe(paid);
    },
  );

  it('passes a free booking’s total of 0 through unchanged (§ 10 item 39)', () => {
    expect(
      toConfirmationEmail({ ...row(), totalCents: 0 }, { paid: false })
        .totalCents,
    ).toBe(0);
  });

  it('passes no list when the class has nothing to bring', () => {
    expect(
      toConfirmationEmail(row({ whatToBring: null }), { paid: false })
        .whatToBring,
    ).toBeNull();
  });
});
