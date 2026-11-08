import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentMode } from '../config/env.validation';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  confirmationEmailSelect,
  toConfirmationEmail,
} from './booking-confirmation-email';
import {
  BOOKING_NOT_FOUND,
  confirmRefusal,
  paymentRequired,
} from './booking-errors';
import { normaliseReference } from './booking-reference';
import { BookingsService } from './bookings.service';
import type { BookingView } from './bookings.types';

/**
 * The interim way a hold becomes a booking while Stripe is on hold (decided
 * 2026-11-08): the customer confirms it and pays nothing. SPEC FR-P2 is
 * paused on staging only; env.validation refuses PAYMENT_MODE=none on a live
 * site, and this refuses to run under any other mode.
 *
 * The confirming itself is BookingsService.confirmBooking, the same call the
 * Stripe webhook will make, so seat counting, late confirmations (§ 10 item
 * 33) and refusals stay exactly as they are when the payments step replaces
 * this file.
 */
@Injectable()
export class UnpaidConfirmationService {
  private readonly logger = new Logger(UnpaidConfirmationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bookings: BookingsService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Confirms the caller's own booking and returns it as GET
   * /bookings/:reference would. Confirming one already confirmed changes
   * nothing and sends nothing, so a double-click or a retry after a lost
   * answer is harmless.
   */
  async confirm(userId: string, reference: string): Promise<BookingView> {
    // Checked before the booking is looked up: the answer is about this
    // site, not the booking, so it tells a caller nothing about references.
    if (
      this.config.getOrThrow<PaymentMode>('PAYMENT_MODE') !== PaymentMode.None
    ) {
      throw paymentRequired();
    }

    // Someone else's booking reads as missing, as in BookingsService.get,
    // and so does anything that cannot be a reference, without a query.
    const normalised = normaliseReference(reference);
    if (!normalised) throw new NotFoundException(BOOKING_NOT_FOUND);
    const own = await this.prisma.booking.findFirst({
      where: { reference: normalised, userId },
      select: { id: true },
    });
    if (!own) throw new NotFoundException(BOOKING_NOT_FOUND);

    const outcome = await this.bookings.confirmBooking(own.id, {
      refuseStarted: true,
    });
    if (outcome.kind === 'refused') throw confirmRefusal(outcome);
    if (outcome.kind === 'confirmed') await this.sendConfirmation(own.id);

    return this.bookings.get(userId, normalised, new Date());
  }

  /**
   * Never fails the request: the booking is already confirmed, and an error
   * page would tell the customer it is not. If the email cannot even be
   * prepared (the database failing at that moment), the log names the
   * booking that went without one.
   */
  private async sendConfirmation(bookingId: string): Promise<void> {
    try {
      const row = await this.prisma.booking.findUniqueOrThrow({
        where: { id: bookingId },
        select: confirmationEmailSelect,
      });
      // Not awaited (ADR-047): the reply does not wait on the provider.
      // MailService never rejects, and records the outcome in email_logs
      // with this booking's id. Nothing was paid, and the email says so.
      void this.mail.sendBookingConfirmation(
        toConfirmationEmail(row, { paid: false }),
      );
    } catch (error) {
      this.logger.error(
        `Booking ${bookingId} is confirmed, but its confirmation email could not be prepared`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
