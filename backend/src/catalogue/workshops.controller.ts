import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { CatalogueService } from './catalogue.service';
import type {
  SessionView,
  WorkshopCard,
  WorkshopDetail,
} from './catalogue.types';

@Controller('workshops')
export class WorkshopsController {
  constructor(private readonly catalogue: CatalogueService) {}

  /** FR-C1. Published classes only, in the admin's order. */
  @Public()
  @Get()
  async list(): Promise<{ workshops: WorkshopCard[] }> {
    return { workshops: await this.catalogue.listWorkshops(new Date()) };
  }

  /** FR-C2. A draft or archived class is a 404, the same as a missing one. */
  @Public()
  @Get(':slug')
  async detail(
    @Param('slug') slug: string,
  ): Promise<{ workshop: WorkshopDetail }> {
    return { workshop: await this.catalogue.getWorkshop(slug, new Date()) };
  }

  /** FR-C3. Upcoming dates for one class, sold-out ones flagged. */
  @Public()
  @Get(':slug/sessions')
  async sessions(
    @Param('slug') slug: string,
  ): Promise<{ sessions: SessionView[] }> {
    return {
      sessions: await this.catalogue.listWorkshopSessions(slug, new Date()),
    };
  }
}
