import { Module } from '@nestjs/common';
import { CatalogueService } from './catalogue.service';
import { SessionsController } from './sessions.controller';
import { WorkshopsController } from './workshops.controller';

@Module({
  controllers: [WorkshopsController, SessionsController],
  providers: [CatalogueService],
  exports: [CatalogueService],
})
export class CatalogueModule {}
