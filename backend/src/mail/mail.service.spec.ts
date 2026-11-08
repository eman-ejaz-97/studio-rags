import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DeliveryMode, EmailStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { readMailConfig } from './mail.config';
import type { MailTransport, OutgoingEmail } from './mail.transport';
import {
  type BookingConfirmationEmail,
  MailService,
  SUPPRESSED_REASON,
} from './mail.service';

const DEVELOPER = 'developer@example.com';
const CUSTOMER = 'customer@example.com';

const RESET = {
  to: DEVELOPER,
  firstName: 'Ada',
  resetUrl: 'http://localhost:3000/reset-password?token=abc123',
  expiresInMinutes: 60,
};

const BOOKING: BookingConfirmationEmail = {
  to: DEVELOPER,
  bookingId: 'booking_1',
  paid: true,
  firstName: 'Ada',
  reference: 'SR-7K4M2',
  workshopTitle: 'Batik for Beginners',
  startsAt: new Date('2027-01-16T00:00:00.000Z'),
  endsAt: new Date('2027-01-16T03:00:00.000Z'),
  deliveryMode: DeliveryMode.IN_PERSON,
  location: 'Sefton Park studio',
  onlineJoinUrl: null,
  seats: 2,
  requiresAccompanyingAdult: false,
  totalCents: 16400,
  whatToBring: null,
};

/** The two email_logs calls MailService makes, with ids handed out in order. */
function createPrismaMock() {
  let next = 0;
  return {
    emailLog: {
      create: jest.fn<Promise<{ id: string }>, [Prisma.EmailLogCreateArgs]>(
        () => Promise.resolve({ id: `email_${++next}` }),
      ),
      update: jest.fn<Promise<unknown>, [Prisma.EmailLogUpdateArgs]>(() =>
        Promise.resolve({}),
      ),
    },
  };
}

function createTransportMock() {
  return {
    name: 'smtp' as const,
    send: jest.fn<Promise<{ messageId: string }>, [OutgoingEmail]>((email) =>
      Promise.resolve({ messageId: `<${email.emailLogId}@test>` }),
    ),
    close: jest.fn(),
  };
}

function setup(env: Record<string, string> = {}) {
  const prisma = createPrismaMock();
  const transport = createTransportMock();
  const config = { getOrThrow: () => 'http://localhost:3000' };
  const service = new MailService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    readMailConfig({ MAIL_TRANSPORT: 'smtp', ...env }),
    transport satisfies MailTransport,
  );
  const logs = {
    log: jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {}),
    error: jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {}),
  };
  return { prisma, transport, service, logs };
}

describe('MailService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('a send that goes through', () => {
    it('writes QUEUED first, then SENT with the provider id and time', async () => {
      const { prisma, transport, service } = setup();

      const outcome = await service.sendPasswordReset(RESET);

      expect(outcome).toEqual({
        status: 'sent',
        emailLogId: 'email_1',
        providerMessageId: '<email_1@test>',
      });
      expect(prisma.emailLog.create).toHaveBeenCalledWith({
        data: {
          to: DEVELOPER,
          template: 'password-reset',
          subject: 'Reset your Studio Rags password',
          bookingId: null,
          status: EmailStatus.QUEUED,
        },
      });
      expect(prisma.emailLog.update).toHaveBeenCalledWith({
        where: { id: 'email_1' },
        data: {
          status: EmailStatus.SENT,
          providerMessageId: '<email_1@test>',
          sentAt: expect.any(Date) as Date,
        },
      });

      // The row exists before the provider is asked, and is settled after.
      const queued = prisma.emailLog.create.mock.invocationCallOrder[0];
      const sent = transport.send.mock.invocationCallOrder[0];
      const settled = prisma.emailLog.update.mock.invocationCallOrder[0];
      expect(queued).toBeLessThan(sent);
      expect(sent).toBeLessThan(settled);
    });

    it('hands the transport both parts, the sender and the row id', async () => {
      const { transport, service } = setup({
        MAIL_FROM: 'Studio Rags <onboarding@resend.dev>',
      });

      await service.sendPasswordReset(RESET);

      const [email] = transport.send.mock.calls[0];
      expect(email).toMatchObject({
        emailLogId: 'email_1',
        from: 'Studio Rags <onboarding@resend.dev>',
        to: DEVELOPER,
        subject: 'Reset your Studio Rags password',
      });
      expect(email.html).toContain(RESET.resetUrl);
      expect(email.text).toContain(RESET.resetUrl);
    });

    it('records a booking confirmation against its booking', async () => {
      const { prisma, transport, service } = setup();

      await service.sendBookingConfirmation(BOOKING);

      expect(prisma.emailLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          template: 'booking-confirmation',
          bookingId: 'booking_1',
          subject: "You're booked in: Batik for Beginners, Sat 16 Jan",
        }) as unknown,
      });
      const [email] = transport.send.mock.calls[0];
      expect(email.text).toContain('SR-7K4M2');
      expect(email.html).toContain('http://localhost:3000/contact');
    });

    it('never writes the recipient address to the log', async () => {
      const { service, logs } = setup();

      await service.sendPasswordReset(RESET);

      for (const call of logs.log.mock.calls) {
        expect(String(call[0])).not.toContain(DEVELOPER);
      }
    });
  });

  describe('the staging allow-list (ADR-040)', () => {
    it('records anyone not on it as SUPPRESSED and never calls the provider', async () => {
      const { prisma, transport, service } = setup({
        MAIL_ALLOWED_RECIPIENTS: DEVELOPER,
      });

      const outcome = await service.sendPasswordReset({
        ...RESET,
        to: CUSTOMER,
      });

      expect(outcome).toEqual({ status: 'suppressed', emailLogId: 'email_1' });
      expect(transport.send).not.toHaveBeenCalled();
      expect(prisma.emailLog.create).toHaveBeenCalledTimes(1);
      expect(prisma.emailLog.create).toHaveBeenCalledWith({
        data: {
          to: CUSTOMER,
          template: 'password-reset',
          subject: 'Reset your Studio Rags password',
          bookingId: null,
          status: EmailStatus.SUPPRESSED,
          error: SUPPRESSED_REASON,
        },
      });
      expect(prisma.emailLog.update).not.toHaveBeenCalled();
    });

    it('keeps the booking id on a suppressed confirmation, so the record exists', async () => {
      const { prisma, service } = setup({ MAIL_ALLOWED_RECIPIENTS: DEVELOPER });

      await service.sendBookingConfirmation({ ...BOOKING, to: CUSTOMER });

      expect(prisma.emailLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          bookingId: 'booking_1',
          status: EmailStatus.SUPPRESSED,
        }) as unknown,
      });
    });

    it('sends to an address on it, whatever its case', async () => {
      const { transport, service } = setup({
        MAIL_ALLOWED_RECIPIENTS: DEVELOPER,
      });

      const outcome = await service.sendPasswordReset({
        ...RESET,
        to: 'Developer@Example.com',
      });

      expect(outcome.status).toBe('sent');
      expect(transport.send).toHaveBeenCalledTimes(1);
    });

    it('sends to anyone when there is no allow-list (Mailpit locally)', async () => {
      const { transport, service } = setup();

      await service.sendPasswordReset({ ...RESET, to: CUSTOMER });

      expect(transport.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('when something goes wrong', () => {
    it('marks the row FAILED with the provider error, and resolves', async () => {
      const { prisma, transport, service, logs } = setup();
      transport.send.mockRejectedValue(
        new Error('Resend refused the email (HTTP 429 rate_limit_exceeded)'),
      );

      const outcome = await service.sendPasswordReset(RESET);

      expect(outcome).toEqual({
        status: 'failed',
        emailLogId: 'email_1',
        error: 'Resend refused the email (HTTP 429 rate_limit_exceeded)',
      });
      expect(prisma.emailLog.update).toHaveBeenCalledTimes(1);
      expect(prisma.emailLog.update).toHaveBeenCalledWith({
        where: { id: 'email_1' },
        data: {
          status: EmailStatus.FAILED,
          error: 'Resend refused the email (HTTP 429 rate_limit_exceeded)',
        },
      });
      expect(logs.error).toHaveBeenCalledWith(
        'Could not send password-reset email email_1: Resend refused the email (HTTP 429 rate_limit_exceeded)',
      );
    });

    it('keeps a long provider error to a sensible length', async () => {
      const { prisma, transport, service } = setup();
      transport.send.mockRejectedValue(new Error('x'.repeat(5000)));

      await service.sendPasswordReset(RESET);

      const { data } = prisma.emailLog.update.mock.calls[0][0];
      expect((data.error as string).length).toBe(1000);
    });

    it('records a template that cannot be built as a failure, not silence', async () => {
      const { prisma, transport, service } = setup();

      const outcome = await service.sendBookingConfirmation({
        ...BOOKING,
        startsAt: new Date('not a date'),
      });

      // The subject needs the date, so this one fails before any row.
      expect(outcome).toMatchObject({ status: 'failed', emailLogId: null });
      expect(transport.send).not.toHaveBeenCalled();
      expect(prisma.emailLog.create).not.toHaveBeenCalled();
    });

    it('resolves rather than throws when the database is down', async () => {
      const { prisma, transport, service, logs } = setup();
      prisma.emailLog.create.mockRejectedValue(
        new Error("Can't reach database server"),
      );

      await expect(service.sendPasswordReset(RESET)).resolves.toEqual({
        status: 'failed',
        emailLogId: null,
        error: "Can't reach database server",
      });
      expect(transport.send).not.toHaveBeenCalled();
      expect(logs.error).toHaveBeenCalledWith(
        "Could not send or record a password-reset email: Can't reach database server",
      );
    });

    it('never marks a delivered email FAILED when only the SENT write fails', async () => {
      const { prisma, service, logs } = setup();
      prisma.emailLog.update.mockRejectedValue(new Error('connection reset'));

      const outcome = await service.sendPasswordReset(RESET);

      expect(outcome).toEqual({
        status: 'sent',
        emailLogId: 'email_1',
        providerMessageId: '<email_1@test>',
      });
      expect(prisma.emailLog.update).toHaveBeenCalledTimes(1);
      expect(prisma.emailLog.update.mock.calls[0][0].data.status).toBe(
        EmailStatus.SENT,
      );
      // The provider's id is logged, so the row can be matched by hand.
      expect(logs.error).toHaveBeenCalledWith(
        'Sent password-reset email email_1 (provider id <email_1@test>), but could not mark it SENT: connection reset',
      );
    });
  });

  describe('sends in flight', () => {
    it('whenIdle waits for every send started so far', async () => {
      const { transport, service } = setup();
      let finish!: () => void;
      transport.send.mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = () => resolve({ messageId: 'late' });
          }),
      );

      void service.sendPasswordReset(RESET);
      let idle = false;
      const waiting = service.whenIdle().then(() => {
        idle = true;
      });

      await new Promise((resolve) => setImmediate(resolve));
      expect(idle).toBe(false);

      finish();
      await waiting;
      expect(idle).toBe(true);
    });

    it('finishes them and closes the transport on shutdown', async () => {
      const { prisma, transport, service } = setup();

      void service.sendPasswordReset(RESET);
      await service.onModuleDestroy();

      expect(prisma.emailLog.update).toHaveBeenCalledTimes(1);
      expect(transport.close).toHaveBeenCalledTimes(1);
    });
  });
});
