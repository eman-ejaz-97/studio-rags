import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailStatus } from '@prisma/client';
import { createElement, type ReactElement } from 'react';
import { PrismaService } from '../prisma/prisma.service';
import {
  MAIL_CONFIG,
  isAllowedRecipient,
  type MailConfig,
} from './mail.config';
import { MAIL_TRANSPORT, type MailTransport } from './mail.transport';
import {
  BOOKING_CONFIRMATION_TEMPLATE,
  BookingConfirmationEmail as BookingConfirmationTemplate,
  type BookingConfirmationProps,
  bookingConfirmationSubject,
} from './templates/booking-confirmation';
import {
  PASSWORD_RESET_TEMPLATE,
  PasswordResetEmail as PasswordResetTemplate,
  type PasswordResetProps,
  passwordResetSubject,
} from './templates/password-reset';
import { renderEmail } from './templates/render';

export type MailTemplate =
  typeof PASSWORD_RESET_TEMPLATE | typeof BOOKING_CONFIRMATION_TEMPLATE;

export interface PasswordResetEmail extends PasswordResetProps {
  to: string;
}

export interface BookingConfirmationEmail extends Omit<
  BookingConfirmationProps,
  'contactUrl'
> {
  to: string;
  /**
   * Recorded on the email_logs row, so the admin can show that this
   * booking's confirmation went out.
   */
  bookingId: string;
}

/**
 * How a send ended. emailLogId is null only when the email could not be
 * built, or its first row could not be written.
 */
export type EmailOutcome =
  | { status: 'sent'; emailLogId: string; providerMessageId: string }
  | { status: 'suppressed'; emailLogId: string }
  | { status: 'failed'; emailLogId: string | null; error: string };

/** Written to email_logs.error on a SUPPRESSED row. */
export const SUPPRESSED_REASON =
  'Not sent: the recipient is not on MAIL_ALLOWED_RECIPIENTS (the staging allow-list, ADR-040)';

/** email_logs.error is free text; a provider's error page should not fill it. */
const MAX_ERROR_LENGTH = 1000;

interface Message {
  template: MailTemplate;
  to: string;
  bookingId?: string;
  /**
   * The subject and the email itself. A function, so that even a mistake in
   * building them (an invalid date, say) happens inside send()'s guard and
   * cannot throw at the caller.
   */
  build: () => { subject: string; body: ReactElement };
}

/**
 * Sends transactional email and records every attempt in email_logs:
 *
 *   recipient not on the allow-list  ->  SUPPRESSED, no provider call
 *   otherwise                        ->  QUEUED, then SENT or FAILED
 *
 * Never throws. Email is a side effect of something that has already
 * happened (a reset requested, a payment taken), and a provider outage must
 * not turn that into an error page. The outcome is in the row, and in the
 * EmailOutcome each method resolves with.
 */
@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  /** Sends still running, so shutdown and tests can wait for them. */
  private readonly inFlight = new Set<Promise<EmailOutcome>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(MAIL_CONFIG) private readonly mailConfig: MailConfig,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {}

  onModuleInit() {
    const allowed = this.mailConfig.allowedRecipients;
    const who =
      allowed === null
        ? 'any recipient'
        : `${allowed.size} allowed recipient${allowed.size === 1 ? '' : 's'}`;
    this.logger.log(`Mail goes through ${this.transport.name}, to ${who}`);
  }

  /**
   * Waits for sends in flight before the app closes. MailModule is not
   * global, so Nest runs this before PrismaService disconnects, and the
   * last rows still get their final status.
   */
  async onModuleDestroy() {
    await this.whenIdle();
    this.transport.close?.();
  }

  /** Resolves once every send started so far has finished. */
  async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  sendPasswordReset(email: PasswordResetEmail): Promise<EmailOutcome> {
    const { to, ...props } = email;
    return this.send({
      template: PASSWORD_RESET_TEMPLATE,
      to,
      build: () => ({
        subject: passwordResetSubject(),
        body: createElement(PasswordResetTemplate, props),
      }),
    });
  }

  /**
   * For the payments slice, once Stripe confirms a booking. Not called from
   * anywhere yet.
   */
  sendBookingConfirmation(
    email: BookingConfirmationEmail,
  ): Promise<EmailOutcome> {
    const { to, bookingId, ...props } = email;
    return this.send({
      template: BOOKING_CONFIRMATION_TEMPLATE,
      to,
      bookingId,
      build: () => ({
        subject: bookingConfirmationSubject(props),
        body: createElement(BookingConfirmationTemplate, {
          ...props,
          contactUrl: `${this.config.getOrThrow<string>('APP_URL')}/contact`,
        }),
      }),
    });
  }

  private send(message: Message): Promise<EmailOutcome> {
    const run = this.deliver(message).catch((err: unknown) => {
      // Reached when the email could not be built or a database write
      // failed; deliver() handles every provider error itself. The row may be
      // missing or stuck at QUEUED, so say which kind of email it was.
      const error = describe(err);
      this.logger.error(
        `Could not send or record a ${message.template} email: ${error}`,
      );
      return { status: 'failed', emailLogId: null, error } as const;
    });

    this.inFlight.add(run);
    void run.finally(() => this.inFlight.delete(run));
    return run;
  }

  private async deliver(message: Message): Promise<EmailOutcome> {
    const { template, to, bookingId } = message;
    const { subject, body } = message.build();
    const row = { to, template, subject, bookingId: bookingId ?? null };

    if (!isAllowedRecipient(this.mailConfig.allowedRecipients, to)) {
      const { id } = await this.prisma.emailLog.create({
        data: {
          ...row,
          status: EmailStatus.SUPPRESSED,
          error: SUPPRESSED_REASON,
        },
      });
      // The row id, never the address: logs are not the place for it.
      this.logger.log(
        `Suppressed ${template} email ${id}: recipient not on the allow-list`,
      );
      return { status: 'suppressed', emailLogId: id };
    }

    const { id } = await this.prisma.emailLog.create({
      data: { ...row, status: EmailStatus.QUEUED },
    });

    let providerMessageId: string;
    try {
      // Rendered after the row exists, so a broken template is recorded as a
      // failed send rather than leaving no trace.
      const { html, text } = renderEmail(body);
      ({ messageId: providerMessageId } = await this.transport.send({
        emailLogId: id,
        from: this.mailConfig.from,
        to,
        subject,
        html,
        text,
      }));
    } catch (err) {
      const error = describe(err);
      await this.prisma.emailLog.update({
        where: { id },
        data: { status: EmailStatus.FAILED, error },
      });
      this.logger.error(`Could not send ${template} email ${id}: ${error}`);
      return { status: 'failed', emailLogId: id, error };
    }

    // Separate from the try above: the email has gone, so a database error
    // here must not mark it FAILED. The row stays QUEUED, and the log keeps
    // the provider's id, so the two can still be matched by hand.
    try {
      await this.prisma.emailLog.update({
        where: { id },
        data: {
          status: EmailStatus.SENT,
          providerMessageId,
          sentAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.error(
        `Sent ${template} email ${id} (provider id ${providerMessageId}), but could not mark it SENT: ${describe(err)}`,
      );
      return { status: 'sent', emailLogId: id, providerMessageId };
    }
    this.logger.log(`Sent ${template} email ${id}`);
    return { status: 'sent', emailLogId: id, providerMessageId };
  }
}

function describe(err: unknown): string {
  // Read by property rather than instanceof Error, which misses errors made
  // in another realm (a DOMException from an aborted fetch, for one).
  const found =
    typeof err === 'object' && err !== null
      ? (err as { message?: unknown }).message
      : undefined;
  const message = typeof found === 'string' ? found : String(err);
  return message.length > MAX_ERROR_LENGTH
    ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…`
    : message;
}
