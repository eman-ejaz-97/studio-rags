import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { once } from 'node:events';
import { IncomingHttpHeaders, Server, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import type { ReadinessReport } from '../src/app.service';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  type EnabledStorageConfig,
  STORAGE_CONFIG,
} from '../src/storage/storage.config';
import { currentDatabase, useTestApp } from './utils/test-app';
import { assertTestDatabaseUrl } from './utils/test-db-guard';

describe('App pipeline (e2e)', () => {
  const ctx = useTestApp();

  describe('GET /api/v1/health/live', () => {
    it('answers 200 with only the status and service name, no token needed', async () => {
      const res = await ctx().http().get('/api/v1/health/live').expect(200);

      expect(res.body).toEqual({ status: 'ok', service: 'studio-rags-api' });
    });

    it('does not query the database', async () => {
      const t = ctx();
      const queryRaw = jest.spyOn(t.prisma, '$queryRaw');

      await t.http().get('/api/v1/health/live').expect(200);
      expect(queryRaw).not.toHaveBeenCalled();

      // The spy is live: readiness, which does query, trips it.
      await t.http().get('/api/v1/health').expect(200);
      expect(queryRaw).toHaveBeenCalled();
    });

    it('is never rate limited, and does not use up the limit', async () => {
      // The global limit is 120 a minute per IP, and every request here comes
      // from 127.0.0.1. A throttled liveness check would read to Render as a
      // dead container.
      for (let i = 0; i < 130; i++) {
        await ctx().http().get('/api/v1/health/live').expect(200);
      }

      await ctx().http().get('/api/v1/health').expect(200);
    });
  });

  describe('GET /api/v1/health', () => {
    it('reports ok with the database up and storage not configured', async () => {
      const res = await ctx().http().get('/api/v1/health').expect(200);
      const { timestamp, ...report } = res.body as ReadinessReport;

      expect(report).toEqual({
        status: 'ok',
        service: 'studio-rags-api',
        database: 'up',
        // .env.test leaves storage off, as local dev and CI do.
        storage: 'not-configured',
      });
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });

    it('is only served under the global prefix', async () => {
      await ctx().http().get('/health').expect(404);
      await ctx().http().get('/health/live').expect(404);
    });
  });

  describe('security headers', () => {
    it('sends the helmet defaults on every response', async () => {
      const res = await ctx().http().get('/api/v1/health');

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
      expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
      expect(res.headers['content-security-policy']).toContain(
        "default-src 'self'",
      );
      // Express advertises itself unless helmet removes the header.
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS', () => {
    it('allows the configured web origin, with credentials', async () => {
      const res = await ctx()
        .http()
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:3000');

      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('never reflects a foreign origin back', async () => {
      const res = await ctx()
        .http()
        .get('/api/v1/health')
        .set('Origin', 'https://evil.example.com');

      // With a fixed origin the header always names the web client, and the
      // browser blocks any page whose origin does not match it. Reflecting the
      // caller's origin alongside credentials would let any site read
      // signed-in responses.
      expect(res.headers['access-control-allow-origin']).toBe(
        'http://localhost:3000',
      );
    });
  });
});

/**
 * Readiness with storage switched on, against a stand-in S3 endpoint on
 * localhost. The real S3Client signs and sends a real HeadBucket over HTTP, so
 * this covers what the unit tests mock away: path-style addressing, SigV4
 * signing with the configured credentials, and the 503 an uptime monitor
 * alerts on. Nothing leaves the machine.
 */
describe('Readiness with storage configured (e2e)', () => {
  interface SeenRequest {
    method?: string;
    url?: string;
    headers: IncomingHttpHeaders;
  }

  let fakeS3: Server;
  let reply = 200;
  const seen: SeenRequest[] = [];
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    fakeS3 = createServer((req, res) => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      req.resume();
      // 403 rather than 5xx: the SDK retries server errors, which would only
      // slow the test down without changing the outcome.
      res.statusCode = reply;
      res.end();
    });
    fakeS3.listen(0, '127.0.0.1');
    await once(fakeS3, 'listening');
    const { port } = fakeS3.address() as AddressInfo;

    const storage: EnabledStorageConfig = {
      enabled: true,
      region: 'ap-southeast-1',
      endpoint: `http://127.0.0.1:${port}`,
      bucket: 'assets',
      credentials: {
        accessKeyId: 'AKIDE2ETEST',
        secretAccessKey: 'e2e-only-secret-not-for-any-real-environment',
      },
    };

    // Same guard as the shared harness: this app connects to the database
    // too, if only to SELECT 1.
    assertTestDatabaseUrl(process.env.DATABASE_URL);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STORAGE_CONFIG)
      .useValue(storage)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      logger: ['error'],
    });
    configureApp(app);
    await app.init();
    await app.listen(0, '127.0.0.1');

    const connectedTo = await currentDatabase(app.get(PrismaService));
    if (connectedTo !== assertTestDatabaseUrl(process.env.DATABASE_URL)) {
      await app.close();
      throw new Error(`Connected to "${connectedTo}". Refusing to continue.`);
    }
  });

  beforeEach(() => {
    seen.length = 0;
    reply = 200;
  });

  afterAll(async () => {
    // No explicit $disconnect: PrismaService.onModuleDestroy now closes the
    // pool, and Jest would report the open handle if it did not.
    await app?.close();
    fakeS3?.close();
  });

  it('reports storage up after a signed, path-style HeadBucket', async () => {
    const res = await http().get('/api/v1/health').expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      database: 'up',
      storage: 'up',
    });
    expect(seen).toHaveLength(1);
    // Path-style: the bucket is in the path, not the host name.
    expect(seen[0].method).toBe('HEAD');
    expect(seen[0].url).toMatch(/^\/assets\/?$/);
    expect(seen[0].headers.host).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(seen[0].headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDE2ETEST\/\d{8}\/ap-southeast-1\/s3\/aws4_request,/,
    );
  });

  it('is degraded with a 503 when the bucket refuses the request', async () => {
    reply = 403;

    const res = await http().get('/api/v1/health').expect(503);
    const { timestamp, ...report } = res.body as ReadinessReport;

    // Same shape as a healthy report: only the verdict and status code change.
    expect(report).toEqual({
      status: 'degraded',
      service: 'studio-rags-api',
      database: 'up',
      storage: 'down',
    });
    expect(typeof timestamp).toBe('string');
  });

  it('keeps liveness at 200 and away from storage while storage is down', async () => {
    reply = 403;

    const res = await http().get('/api/v1/health/live').expect(200);

    expect(res.body).toEqual({ status: 'ok', service: 'studio-rags-api' });
    expect(seen).toHaveLength(0);
  });
});
