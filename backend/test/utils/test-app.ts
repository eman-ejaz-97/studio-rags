import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerStorageService, getStorageToken } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { TokenService } from '../../src/auth/token.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TEST_DATABASE_SUFFIX, assertTestDatabaseUrl } from './test-db-guard';

export interface TestApp {
  // Express-typed, as in main.ts: configureApp sets Express options.
  app: NestExpressApplication;
  prisma: PrismaService;
  tokens: TokenService;
  config: ConfigService;
  /** A supertest request builder bound to the running server. */
  http: () => ReturnType<typeof request>;
  resetDatabase: () => Promise<void>;
  resetThrottling: () => void;
  close: () => Promise<void>;
}

/**
 * Boots the real AppModule through the same configureApp() as main.ts, on a
 * real port, against the test database. Refuses to start if anything points
 * at a database whose name does not end in "_test".
 */
export async function createTestApp(): Promise<TestApp> {
  // Second line of defence. The setup file checked DATABASE_URL before any
  // import; by now AppModule has been imported and ConfigModule has had its
  // chance to back-fill from ../.env, so check again before anything connects.
  assertTestDatabaseUrl(process.env.DATABASE_URL);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  // Errors only: the reset-link log line and the reuse-detection warning are
  // expected outcomes here, not noise worth reading on every run.
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: ['error'],
  });
  configureApp(app);
  await app.init();
  // A real listening port. Left unbound, supertest binds and closes a server
  // per request, and two concurrent requests then trip over each other.
  await app.listen(0, '127.0.0.1');

  const prisma = app.get(PrismaService);
  const config = app.get(ConfigService);

  // Third line: ask the connection the app actually holds where it landed.
  const connectedTo = await currentDatabase(prisma);
  const expected = assertTestDatabaseUrl(process.env.DATABASE_URL);
  if (
    connectedTo !== expected ||
    !connectedTo.endsWith(TEST_DATABASE_SUFFIX) ||
    config.get<string>('DATABASE_URL') !== process.env.DATABASE_URL
  ) {
    await app.close();
    await prisma.$disconnect();
    throw new Error(
      `E2E app connected to "${connectedTo}", expected "${expected}". Refusing to continue.`,
    );
  }

  const throttlerStorage = app.get<ThrottlerStorageService>(getStorageToken());

  return {
    app,
    prisma,
    config,
    tokens: app.get(TokenService),
    http: () => request(app.getHttpServer()),
    resetDatabase: () => resetDatabase(prisma),
    resetThrottling: () => resetThrottling(throttlerStorage),
    close: async () => {
      await app.close();
      // PrismaService.onModuleDestroy already disconnects; this repeat is a
      // harmless no-op that keeps the harness from depending on it, since an
      // open pool would leave Jest waiting after the last test.
      await prisma.$disconnect();
    },
  };
}

export async function currentDatabase(prisma: PrismaService): Promise<string> {
  const rows = await prisma.$queryRaw<
    { current_database: string }[]
  >`SELECT current_database()`;
  return rows[0].current_database;
}

/**
 * Empties the auth tables. CASCADE follows every foreign key into users, so
 * bookings, reviews and credits go too once later suites create them.
 *
 * The URL is re-checked first, and the database checks its own name inside the
 * same statement, so the truncate cannot run against a non-test database even
 * if process.env were changed after the app connected.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  assertTestDatabaseUrl(process.env.DATABASE_URL);

  await prisma.$executeRaw`
    DO $$
    BEGIN
      IF right(current_database(), 5) <> '_test' THEN
        RAISE EXCEPTION 'Refusing to truncate non-test database %', current_database();
      END IF;
      TRUNCATE TABLE "users", "refresh_tokens", "password_reset_tokens"
        RESTART IDENTITY CASCADE;
    END
    $$;
  `;
}

/**
 * The throttler keeps hit counts in memory, keyed by client IP, and every
 * request here comes from 127.0.0.1. Clearing the counts between tests keeps
 * the guard itself real while stopping one test's traffic spilling into the
 * next one's limit.
 */
export function resetThrottling(storage: ThrottlerStorageService): void {
  // Cancel the pending hit-expiry timers first: each one reads its entry back
  // from the map when it fires, and would throw once the map is cleared.
  storage.onApplicationShutdown();
  storage.storage.clear();
}

/**
 * One app per test file, a clean database and clean throttle counts per test.
 * Returns a getter, because the app only exists once beforeAll has run.
 */
export function useTestApp(): () => TestApp {
  let ctx: TestApp | undefined;
  const get = (): TestApp => {
    if (!ctx) throw new Error('The e2e app has not started yet.');
    return ctx;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await get().resetDatabase();
    get().resetThrottling();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  return get;
}
