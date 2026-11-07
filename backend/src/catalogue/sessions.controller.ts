import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { CatalogueService } from './catalogue.service';
import type { AvailabilityView, CalendarSessionView } from './catalogue.types';
import { SessionRangeDto, resolveRange } from './dto/session-range.dto';

@Controller('sessions')
export class SessionsController {
  constructor(private readonly catalogue: CatalogueService) {}

  /** FR-C3. The calendar: every class's dates in [from, to). */
  @Public()
  @Get()
  async list(
    @Query() query: SessionRangeDto,
  ): Promise<{ from: string; to: string; sessions: CalendarSessionView[] }> {
    const now = new Date();
    const { from, to } = resolveRange(query, now);
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      sessions: await this.catalogue.listSessions(from, to, now),
    };
  }

  /**
   * The live seat count. Never cached anywhere: a stale "2 left" is how a
   * customer reaches checkout for a class that sold out a minute ago.
   */
  @Public()
  @Get(':id/availability')
  @Header('Cache-Control', 'no-store')
  async availability(@Param('id') id: string): Promise<AvailabilityView> {
    return this.catalogue.availability(id, new Date());
  }
}
