import { Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import type { BookingsService } from './bookings.service';
import { HOLD_EXPIRY_JOB, HoldExpiryTask } from './hold-expiry.task';

function taskWith(expireLapsedHolds: jest.Mock) {
  return new HoldExpiryTask({
    expireLapsedHolds,
  } as unknown as BookingsService);
}

describe('HoldExpiryTask', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is registered to run every minute, one run at a time', () => {
    // Read back what @Cron recorded, so a change to the schedule shows here.
    const run = Object.getOwnPropertyDescriptor(HoldExpiryTask.prototype, 'run')
      ?.value as object;
    const values = Object.fromEntries(
      Reflect.getMetadataKeys(run).map((key: unknown) => [
        String(key),
        Reflect.getMetadata(key, run) as unknown,
      ]),
    );

    expect(Object.values(values)).toContainEqual(
      expect.objectContaining({
        cronTime: CronExpression.EVERY_MINUTE,
        name: HOLD_EXPIRY_JOB,
        waitForCompletion: true,
      }),
    );
  });

  it('logs how many holds it expired, and stays quiet when there were none', async () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    await expect(taskWith(jest.fn().mockResolvedValue(2)).run()).resolves.toBe(
      2,
    );
    await expect(taskWith(jest.fn().mockResolvedValue(0)).run()).resolves.toBe(
      0,
    );

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('Expired 2 lapsed holds');
  });

  it('logs a failure instead of throwing it', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    await expect(
      taskWith(jest.fn().mockRejectedValue(new Error('asleep'))).run(),
    ).resolves.toBe(0);

    expect(error).toHaveBeenCalledWith(
      'Hold expiry sweep failed',
      expect.stringContaining('asleep'),
    );
  });
});
