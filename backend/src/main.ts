import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  configureApp(app);

  app.enableShutdownHooks();
  app.get(PrismaService).enableShutdownHooks(app);

  // Both validated in env.validation.ts. Render sets PORT itself and only
  // routes to a server bound on 0.0.0.0, hence HOST's default.
  const port = config.get<number>('PORT') ?? 3001;
  const host = config.get<string>('HOST') ?? '0.0.0.0';
  await app.listen(port, host);

  logger.log(`API listening on http://${host}:${port}/api/v1`);
}

void bootstrap();
