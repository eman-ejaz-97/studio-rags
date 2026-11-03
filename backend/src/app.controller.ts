import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from './common/decorators/public.decorator';
import {
  AppService,
  type LivenessReport,
  type ReadinessReport,
} from './app.service';

@Controller('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  /**
   * Liveness, for Render's health check. No I/O; see AppService.liveness.
   * Exempt from rate limiting: it costs nothing to serve, and a 429 here
   * (say, behind a proxy where every caller shares one IP) would read as a
   * dead container and get it restarted.
   */
  @Public()
  @SkipThrottle()
  @Get('live')
  live(): LivenessReport {
    return this.appService.liveness();
  }

  /**
   * Readiness: database and storage. A degraded report is still a report, so
   * the body keeps the same shape; only the status code changes, to 503, which
   * is what an uptime monitor alerts on.
   */
  @Public()
  @Get()
  async readiness(
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReadinessReport> {
    const report = await this.appService.readiness();
    res.status(
      report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return report;
  }
}
