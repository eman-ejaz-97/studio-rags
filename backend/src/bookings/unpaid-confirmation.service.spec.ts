import { Logger, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { BookingStatus, DeliveryMode } from '@prisma/client';
import { ProblemException } from '../common/filters/problem-details.filter';
import { PaymentMode } from '../config/env.validation';
import type { EmailOutcome, MailService } from '../mail/mail.service';
import type { PrismaService } from '../prisma/prisma.service';
import {
  type ConfirmationEmailRow,
  confirmationEmailSelect,
  toConfirmationEmail,
} from './booking-confirmation-email';
import type { BookingsService } from './bookings.service';
import type { BookingView, ConfirmOutcome } from './bookings.types';
import { UnpaidConfirmationService } from './unpaid-confirmation.service';

/**
 * The interim confirm step against stand-ins. test/bookings/confirm.e2e-spec
 * proves the same through HTTP against Postgres, with the real
 * confirmBooking and the in-memory outbox.
 */

const emailRow: ConfirmationEmailRow = {
  id: 'booking_1',
  reference: 'SR-7K4M2',
  seats: 1,
  totalCents: 8200,
  user: { email: 'ada@example.com', firstName: 'Ada' },
  session: {
    startsAt: new Date('2026-11-21T00:00:00.000Z'),
    endsAt: new Date('2026-11-21T03:00:00.000Z'),
    location: 'Studio Rags',
    onlineJoinUrl: null,
    workshop: {
      title: 'Batik',
      deliveryMode: DeliveryMode.IN_PERSON,
      requiresAccompanyingAdult: false,
      whatToBring: null,
    },
  },
};

const view = {
  reference: 'SR-7K4M2',
  status: BookingStatus.CONFIRMED,
} as BookingView;

function setup(
  options: {
    mode?: PaymentMode;
    own?: { id: string } | null;
    outcome?: ConfirmOutcome;
  } = {},
) {
  const prisma = {
    booking: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options.own === undefined ? { id: 'booking_1' } : options.own,
        ),
      findUniqueOrThrow: jest.fn().mockResolvedValue(emailRow),
    },
  };
  const bookings = {
    confirmBooking: jest.fn().mockResolvedValue(
      options.outcome ?? {
        kind: 'confirmed',
        bookingId: 'booking_1',
        reference: 'SR-7K4M2',
      },
    ),
    get: jest.fn().mockResolvedValue(view),
  };
  const mail = {
    sendBookingConfirmation: jest
      .fn<
        ReturnType<MailService['sendBookingConfirmation']>,
        Parameters<MailService['sendBookingConfirmation']>
      >()
      .mockResolvedValue({
        status: 'sent',
        emailLogId: 'log_1',
        providerMessageId: 'memory-log_1',
      }),
  };
  const config = {
    getOrThrow: jest.fn().mockReturnValue(options.mode ?? PaymentMode.None),
  };
  const service = new UnpaidConfirmationService(
    prisma as unknown as PrismaService,
    bookings as unknown as BookingsService,
    mail as unknown as MailService,
    config as unknown as ConfigService,
  );
  return { service, prisma, bookings, mail, config };
}

async function refusalOf(promise: Promise<unknown>) {
  const error: unknown = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProblemException);
  return (error as ProblemException).getResponse() as Record<string, unknown>;
}

describe('UnpaidConfirmationService.confirm', () => {
  afterEach(() => jest.restoreAllMocks());

  it('confirms the caller’s own booking, refusing a started session, and returns it as GET does', async () => {
    const { service, prisma, bookings } = setup();

    await expect(service.confirm('user_1', ' sr-7k4m2 ')).resolves.toBe(view);

    expect(prisma.booking.findFirst).toHaveBeenCalledWith({
      where: { reference: 'SR-7K4M2', userId: 'user_1' },
      select: { id: true },
    });
    expect(bookings.confirmBooking).toHaveBeenCalledWith('booking_1', {
      refuseStarted: true,
    });
    expect(bookings.get).toHaveBeenCalledWith(
      'user_1',
      'SR-7K4M2',
      expect.any(Date),
    );
  });

  it('emails the customer once on a fresh confirmation, with the booking id for email_logs', async () => {
    const { service, prisma, mail } = setup();

    await service.confirm('user_1', 'SR-7K4M2');

    expect(prisma.booking.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'booking_1' },
      select: confirmationEmailSelect,
    });
    expect(mail.sendBookingConfirmation).toHaveBeenCalledTimes(1);
    expect(mail.sendBookingConfirmation).toHaveBeenCalledWith(
      toConfirmationEmail(emailRow),
    );
    expect(mail.sendBookingConfirmation.mock.calls[0][0]).toMatchObject({
      to: 'ada@example.com',
      bookingId: 'booking_1',
    });
  });

  it('answers without waiting for the email to go (ADR-047)', async () => {
    const { service, mail } = setup();
    mail.sendBookingConfirmation.mockReturnValue(
      new Promise<EmailOutcome>(() => {}),
    );

    await expect(service.confirm('user_1', 'SR-7K4M2')).resolves.toBe(view);
    expect(mail.sendBookingConfirmation).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for a booking that was already confirmed, and still answers with it', async () => {
    const { service, prisma, mail } = setup({
      outcome: {
        kind: 'already-confirmed',
        bookingId: 'booking_1',
        reference: 'SR-7K4M2',
      },
    });

    await expect(service.confirm('user_1', 'SR-7K4M2')).resolves.toBe(view);

    expect(prisma.booking.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mail.sendBookingConfirmation).not.toHaveBeenCalled();
  });

  it('still answers 200 when the email cannot be prepared, and logs which booking went without one', async () => {
    const { service, prisma, mail } = setup();
    prisma.booking.findUniqueOrThrow.mockRejectedValue(
      new Error('database asleep'),
    );
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(service.confirm('user_1', 'SR-7K4M2')).resolves.toBe(view);

    expect(mail.sendBookingConfirmation).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith(
      'Booking booking_1 is confirmed, but its confirmation email could not be prepared',
      'database asleep',
    );
  });

  it('refuses under PAYMENT_MODE=stripe before looking anything up', async () => {
    const { service, prisma, bookings, config } = setup({
      mode: PaymentMode.Stripe,
    });

    expect(await refusalOf(service.confirm('user_1', 'SR-7K4M2'))).toEqual(
      expect.objectContaining({
        type: '/problems/payment-required',
        status: 409,
      }),
    );
    expect(config.getOrThrow).toHaveBeenCalledWith('PAYMENT_MODE');
    expect(prisma.booking.findFirst).not.toHaveBeenCalled();
    expect(bookings.confirmBooking).not.toHaveBeenCalled();
  });

  it('answers 404 for someone else’s or an unknown reference, confirming nothing', async () => {
    const { service, bookings } = setup({ own: null });

    await expect(service.confirm('user_2', 'SR-7K4M2')).rejects.toThrow(
      new NotFoundException('Booking not found'),
    );
    expect(bookings.confirmBooking).not.toHaveBeenCalled();
  });

  it('answers 404 for something that cannot be a reference, without a query', async () => {
    const { service, prisma } = setup();

    await expect(service.confirm('user_1', "SR-1' OR '1'='1")).rejects.toThrow(
      new NotFoundException('Booking not found'),
    );
    expect(prisma.booking.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ['no-seats', { reason: 'no-seats' }, { type: '/problems/hold-lapsed' }],
    [
      'cancelled',
      { reason: 'cancelled' },
      { type: '/problems/booking-cancelled' },
    ],
    [
      'session-unavailable (started)',
      { reason: 'session-unavailable', notOnSale: 'started' },
      { type: '/problems/session-not-on-sale', reason: 'started' },
    ],
  ] as const)(
    'turns a %s refusal into its 409 problem, and sends nothing',
    async (_, refusal, problem) => {
      const { service, bookings, mail } = setup({
        outcome: {
          kind: 'refused',
          bookingId: 'booking_1',
          ...refusal,
        } as ConfirmOutcome,
      });

      expect(await refusalOf(service.confirm('user_1', 'SR-7K4M2'))).toEqual(
        expect.objectContaining({ ...problem, status: 409 }),
      );
      expect(mail.sendBookingConfirmation).not.toHaveBeenCalled();
      expect(bookings.get).not.toHaveBeenCalled();
    },
  );
});
