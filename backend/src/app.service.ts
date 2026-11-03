import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './storage/storage.service';

export const SERVICE_NAME = 'studio-rags-api';

/**
 * Upper bound on each readiness check. Long enough for a Neon compute to wake
 * from scale-to-zero (usually under a second or two), short enough that an
 * uptime monitor gets an answer before its own request times out.
 *
 * It must also stay well inside the staging status page's own wait
 * (HEALTH_TIMEOUT_MS in frontend/src/app/page.tsx, 8 s). When the API is up
 * but the database hangs, the API has to answer "database down" before the
 * page gives up, or the page tells the visitor the whole server is asleep.
 * app.controller.spec.ts checks the two against each other.
 */
export const READINESS_CHECK_TIMEOUT_MS = 5_000;

export type LivenessReport = { status: 'ok'; service: string };

export type DependencyStatus = 'up' | 'down';
export type StorageStatus = DependencyStatus | 'not-configured';

export interface ReadinessReport {
  status: 'ok' | 'degraded';
  service: string;
  database: DependencyStatus;
  storage: StorageStatus;
  timestamp: string;
}

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Is the process up and serving HTTP? Render's health checker calls this
   * every few seconds, so it must touch nothing: a database query here would
   * keep the Neon compute awake around the clock and spend the free plan's
   * monthly compute hours on health checks alone.
   */
  liveness(): LivenessReport {
    return { status: 'ok', service: SERVICE_NAME };
  }

  /**
   * Can the API do its job? Checks the database and, when configured, the
   * bucket. For an uptime monitor or a human, not for the platform's restart
   * logic: restarting the container never fixes a database outage. Note that
   * each call wakes Neon, so poll it no more often than every few minutes.
   */
  async readiness(): Promise<ReadinessReport> {
    const [database, storage] = await Promise.all([
      this.checkDatabase(),
      this.checkStorage(),
    ]);

    return {
      // Storage that was never configured is a deliberate setup (local dev,
      // CI), not a fault. Storage that is configured but unreachable is.
      status: database === 'up' && storage !== 'down' ? 'ok' : 'degraded',
      service: SERVICE_NAME,
      database,
      storage,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    try {
      await withTimeout(
        this.prisma.$queryRaw`SELECT 1`,
        READINESS_CHECK_TIMEOUT_MS,
      );
      return 'up';
    } catch (error) {
      // The platform's log stream is the only place an outage leaves a
      // trace; a silent 'down' would leave nothing to go on.
      this.logger.warn(
        `Readiness: database is down (${describeFailure(error)})`,
      );
      return 'down';
    }
  }

  private async checkStorage(): Promise<StorageStatus> {
    if (!this.storage.isEnabled()) return 'not-configured';
    try {
      await this.storage.ping(READINESS_CHECK_TIMEOUT_MS);
      return 'up';
    } catch (error) {
      this.logger.warn(
        `Readiness: storage is down (${describeFailure(error)})`,
      );
      return 'down';
    }
  }
}

/**
 * Names a failure without quoting its message. A driver's message can carry
 * a host name or, from a mistyped setting, a whole connection string; the
 * error's class and code (Prisma's P1001, an S3 status) say enough to start.
 */
export function describeFailure(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown error';
  const { name, code, errorCode, $metadata } = error as {
    name?: unknown;
    code?: unknown;
    errorCode?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  const parts = [name, errorCode ?? code, $metadata?.httpStatusCode].filter(
    (part) => typeof part === 'string' || typeof part === 'number',
  );
  return parts.length > 0 ? parts.join(' ') : 'unknown error';
}

class ReadinessTimeoutError extends Error {
  override name = 'ReadinessTimeout';
}

/** Rejects if the promise has not settled in time. Prisma queries cannot be
 * cancelled, so this stops the wait, not the query. */
function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ReadinessTimeoutError(`Timed out after ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() =>
    clearTimeout(timer),
  );
}
