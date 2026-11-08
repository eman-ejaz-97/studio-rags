import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { HoldExpiryTask } from './hold-expiry.task';

/**
 * Exports BookingsService for the payments slice, which needs only its seam:
 * findPayableHold and confirmBooking.
 */
@Module({
  controllers: [BookingsController],
  providers: [BookingsService, HoldExpiryTask],
  exports: [BookingsService],
})
export class BookingsModule {}
