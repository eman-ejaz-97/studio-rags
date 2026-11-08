import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BookingsModule } from './bookings/bookings.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { EnquiriesModule } from './enquiries/enquiries.module';
import { CsrfExceptionFilter } from './common/filters/csrf-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { ClientThrottlerGuard } from './common/guards/client-throttler.guard';
import { CsrfGuard } from './common/guards/csrf.guard';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // One .env at the repo root serves both the API and the web client.
      envFilePath: ['../.env', '.env'],
      // Tests get their whole environment from backend/.env.test. Reading
      // ../.env as well would back-fill any variable that file leaves out
      // from the developer's real secrets (Stripe, mail) or dev database.
      // Read at import time, so NODE_ENV must already be set: dotenv sets it
      // from .env.test, and Jest sets it to "test" when it is unset.
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: validateEnv,
      cache: true,
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    // Runs @Cron jobs in any module: the hold expiry sweep (bookings).
    ScheduleModule.forRoot(),
    PrismaModule,
    StorageModule,
    AuthModule,
    CatalogueModule,
    EnquiriesModule,
    BookingsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Order matters: authenticate, then check the role.
    // Counts per visitor as clientAddress() finds them (common/client-address.ts).
    { provide: APP_GUARD, useClass: ClientThrottlerGuard },
    // Refuses forged writes before any session is looked at (common/csrf.ts).
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
    { provide: APP_FILTER, useClass: CsrfExceptionFilter },
  ],
})
export class AppModule {}
