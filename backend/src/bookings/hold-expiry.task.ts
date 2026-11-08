import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BookingsService } from './bookings.service';

export const HOLD_EXPIRY_JOB = 'expire-lapsed-holds';

/**
 * FR-A5 step 5: once a minute, marks holds that ran out as EXPIRED.
 *
 * Only tidies the status column. Seat counts never wait for it, because they
 * already ignore a hold whose time is up, so a sleeping instance (Render's
 * free plan) or a failed run costs nothing but a stale label in the table.
 */
@Injectable()
export class HoldExpiryTask {
  private readonly logger = new Logger(HoldExpiryTask.name);

  constructor(private readonly bookings: BookingsService) {}

  // waitForCompletion: if the database is slow to wake, the next tick is
  // skipped rather than stacking a second sweep on the first.
  @Cron(CronExpression.EVERY_MINUTE, {
    name: HOLD_EXPIRY_JOB,
    waitForCompletion: true,
  })
  async run(): Promise<number> {
    try {
      const expired = await this.bookings.expireLapsedHolds();
      if (expired > 0) {
        this.logger.log(
          `Expired ${expired} lapsed hold${expired === 1 ? '' : 's'}`,
        );
      }
      return expired;
    } catch (error) {
      // Logged, not thrown: the next tick tries again, and nothing is waiting.
      this.logger.error(
        'Hold expiry sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    }
  }
}
