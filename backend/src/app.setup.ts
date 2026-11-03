import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/**
 * Everything applied to the app between create() and listen(). Kept apart from
 * main.ts so the e2e suite runs the exact same pipeline as the real server; a
 * hand-copied setup in the tests would drift and stop proving anything.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get(ConfigService);

  // Behind a proxy, every request arrives from the proxy's address, so the
  // login rate limit would be shared by every visitor at once. Trusting N hops
  // makes req.ip the client address as the outermost of those N proxies saw
  // it. Left off unless configured, because trusting a header nobody in front
  // of us rewrites lets any client pick its own address, and with it a fresh
  // rate-limit allowance.
  //
  // Count only proxies that append the address they saw to X-Forwarded-For.
  // One that forwards the header unchanged adds no entry, so counting it
  // makes the API believe whatever the visitor wrote. Next's standalone
  // server is such a proxy on its own; the frontend Docker image preloads
  // frontend/docker/forwarded-for.mjs so that it appends like the rest.
  const trustedHops = Number(config.get<number>('TRUST_PROXY') ?? 0);
  if (trustedHops > 0) {
    app.set('trust proxy', trustedHops);
  }

  app.use(helmet());
  app.use(cookieParser());

  app.enableCors({
    origin: config.getOrThrow<string>('CORS_ORIGIN'),
    // Required for the httpOnly auth cookies to travel cross-origin in dev,
    // where the web client is on :3000 and the API on :3001.
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
}
