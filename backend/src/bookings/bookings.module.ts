import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { HoldExpiryTask } from './hold-expiry.task';
import { UnpaidConfirmationService } from './unpaid-confirmation.service';

/**
 * Exports BookingsService for the payments slice, which needs only its seam:
 * findPayableHold and confirmBooking.
 *
 * Imports MailModule for the confirmation email, which the interim
 * no-payment confirmation sends (UnpaidConfirmationService).
 */
@Module({
  imports: [MailModule],
  controllers: [BookingsController],
  providers: [BookingsService, HoldExpiryTask, UnpaidConfirmationService],
  exports: [BookingsService],
})
export class BookingsModule {}
