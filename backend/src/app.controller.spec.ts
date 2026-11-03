import { HttpStatus, Logger, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AppController } from './app.controller';
import { AppService, READINESS_CHECK_TIMEOUT_MS } from './app.service';
import { IS_PUBLIC_KEY } from './common/decorators/public.decorator';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './storage/storage.service';

type PrismaMock = { $queryRaw: jest.Mock };
type StorageMock = { isEnabled: jest.Mock; ping: jest.Mock };

/**
 * A minimal Express response: the controller only ever sets the status. The
 * spy is returned on its own so assertions never detach a method from res.
 */
function fakeResponse() {
  const status = jest.fn();
  const res = { status } as unknown as Response;
  status.mockReturnValue(res);
  return { res, status };
}

async function build(prisma: PrismaMock, storage: StorageMock) {
  const module: TestingModule = await Test.createTestingModule({
    controllers: [AppController],
    providers: [
      AppService,
      { provide: PrismaService, useValue: prisma },
      { provide: StorageService, useValue: storage },
    ],
  }).compile();
  return module.get(AppController);
}

const dbUp = (): PrismaMock => ({
  $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
});
const dbDown = (): PrismaMock => ({
  $queryRaw: jest.fn().mockRejectedValue(new Error('connection refused')),
});
const storageOff = (): StorageMock => ({
  isEnabled: jest.fn().mockReturnValue(false),
  ping: jest.fn(),
});
const storageUp = (): StorageMock => ({
  isEnabled: jest.fn().mockReturnValue(true),
  ping: jest.fn().mockResolvedValue(undefined),
});
const storageDown = (): StorageMock => ({
  isEnabled: jest.fn().mockReturnValue(true),
  ping: jest.fn().mockRejectedValue(new Error('AccessDenied')),
});

describe('AppController', () => {
  describe('GET /health/live', () => {
    it('reports ok with the service name and nothing else', async () => {
      const controller = await build(dbUp(), storageUp());

      expect(controller.live()).toEqual({
        status: 'ok',
        service: 'studio-rags-api',
      });
    });

    it('touches neither the database nor storage', async () => {
      // Every property read on either dependency is recorded once armed. Any
      // read at all, not just a call, would mean liveness depends on I/O.
      const touched: string[] = [];
      let armed = false;
      const tripwire = (label: string) =>
        new Proxy(
          {},
          {
            get(_target, prop) {
              if (armed) touched.push(`${label}.${String(prop)}`);
              // Not a thenable: Nest must not mistake the mock for a promise.
              return prop === 'then' ? undefined : jest.fn();
            },
          },
        );

      const module = await Test.createTestingModule({
        controllers: [AppController],
        providers: [
          AppService,
          { provide: PrismaService, useValue: tripwire('prisma') },
          { provide: StorageService, useValue: tripwire('storage') },
        ],
      }).compile();
      const controller = module.get(AppController);

      armed = true;
      const result = controller.live();
      armed = false;

      expect(result).toEqual({ status: 'ok', service: 'studio-rags-api' });
      expect(touched).toEqual([]);
    });

    it('answers synchronously, so it cannot be waiting on anything', async () => {
      const controller = await build(dbUp(), storageUp());

      expect(controller.live()).not.toBeInstanceOf(Promise);
    });
  });

  describe('GET /health (readiness)', () => {
    it('is ok and 200 with the database up and storage not configured', async () => {
      const prisma = dbUp();
      const storage = storageOff();
      const { res, status } = fakeResponse();

      const { timestamp, ...report } = await (
        await build(prisma, storage)
      ).readiness(res);

      expect(report).toEqual({
        status: 'ok',
        service: 'studio-rags-api',
        database: 'up',
        storage: 'not-configured',
      });
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
      expect(status).toHaveBeenCalledWith(HttpStatus.OK);
      // Never pings a bucket that was never configured.
      expect(storage.ping).not.toHaveBeenCalled();
    });

    it('is ok and 200 with the database and storage both up', async () => {
      const storage = storageUp();
      const { res, status } = fakeResponse();

      const report = await (await build(dbUp(), storage)).readiness(res);

      expect(report).toMatchObject({
        status: 'ok',
        database: 'up',
        storage: 'up',
      });
      expect(status).toHaveBeenCalledWith(HttpStatus.OK);
      expect(storage.ping).toHaveBeenCalledWith(READINESS_CHECK_TIMEOUT_MS);
    });

    it('is degraded and 503 when configured storage is down', async () => {
      const { res, status } = fakeResponse();

      const report = await (await build(dbUp(), storageDown())).readiness(res);

      expect(report).toMatchObject({
        status: 'degraded',
        database: 'up',
        storage: 'down',
      });
      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('is degraded and 503 when the database is down', async () => {
      const { res, status } = fakeResponse();

      const report = await (await build(dbDown(), storageOff())).readiness(res);

      expect(report).toMatchObject({
        status: 'degraded',
        database: 'down',
        storage: 'not-configured',
      });
      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('reports both failures at once', async () => {
      const { res, status } = fakeResponse();

      const report = await (
        await build(dbDown(), storageDown())
      ).readiness(res);

      expect(report).toMatchObject({
        status: 'degraded',
        database: 'down',
        storage: 'down',
      });
      expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    });

    it('calls a database that never answers down once the timeout passes', async () => {
      jest.useFakeTimers();
      try {
        const hung: PrismaMock = {
          $queryRaw: jest.fn().mockReturnValue(new Promise(() => {})),
        };
        const { res, status } = fakeResponse();
        const controller = await build(hung, storageOff());

        const pending = controller.readiness(res);
        await jest.advanceTimersByTimeAsync(READINESS_CHECK_TIMEOUT_MS);

        await expect(pending).resolves.toMatchObject({
          status: 'degraded',
          database: 'down',
        });
        expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('readiness failures in the log', () => {
    let warn: jest.SpyInstance;
    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    });
    afterEach(() => warn.mockRestore());

    const logged = () =>
      warn.mock.calls.map((call: unknown[]) => String(call[0]));

    it("names a database failure by class and code, and never quotes the driver's message", async () => {
      const unreachable = Object.assign(
        new Error(
          "Can't reach database server at postgresql://studio:hunter2-secret@db.internal:5432/app",
        ),
        { name: 'PrismaClientInitializationError', errorCode: 'P1001' },
      );
      const prisma = { $queryRaw: jest.fn().mockRejectedValue(unreachable) };

      await (await build(prisma, storageOff())).readiness(fakeResponse().res);

      expect(logged()).toEqual([
        'Readiness: database is down (PrismaClientInitializationError P1001)',
      ]);
      expect(logged().join()).not.toMatch(/hunter2|db\.internal|postgresql:/);
    });

    it('names a storage failure by class and HTTP status', async () => {
      const denied = Object.assign(new Error('Access Denied for key AKID…'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      const storage = {
        isEnabled: jest.fn().mockReturnValue(true),
        ping: jest.fn().mockRejectedValue(denied),
      };

      await (await build(dbUp(), storage)).readiness(fakeResponse().res);

      expect(logged()).toEqual([
        'Readiness: storage is down (AccessDenied 403)',
      ]);
    });

    it('logs a database that never answers as a timeout', async () => {
      jest.useFakeTimers();
      try {
        const hung = {
          $queryRaw: jest.fn().mockReturnValue(new Promise(() => {})),
        };
        const pending = (await build(hung, storageOff())).readiness(
          fakeResponse().res,
        );
        await jest.advanceTimersByTimeAsync(READINESS_CHECK_TIMEOUT_MS);
        await pending;
      } finally {
        jest.useRealTimers();
      }

      expect(logged()).toEqual([
        'Readiness: database is down (ReadinessTimeout)',
      ]);
    });

    it('logs nothing when everything is up', async () => {
      await (await build(dbUp(), storageUp())).readiness(fakeResponse().res);

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('readiness timeout against the status page', () => {
    // A cross-package check on purpose. The staging page waits
    // HEALTH_TIMEOUT_MS for this endpoint and, if it runs out, tells the
    // visitor the server is asleep. With the API up and the database hung,
    // the API must answer "database down" first, with time to spare for the
    // trip from Vercel to Render.
    it('answers at least two seconds before the status page gives up', () => {
      const page = readFileSync(
        path.resolve(__dirname, '../../frontend/src/app/page.tsx'),
        'utf8',
      );
      const match = /const HEALTH_TIMEOUT_MS = ([\d_]+);/.exec(page);
      expect(match).not.toBeNull();
      const pageTimeoutMs = Number(match![1].replace(/_/g, ''));

      expect(READINESS_CHECK_TIMEOUT_MS + 2_000).toBeLessThanOrEqual(
        pageTimeoutMs,
      );
    });
  });

  describe('routing metadata', () => {
    it('serves both endpoints under /health with GET', () => {
      const live = Object.getOwnPropertyDescriptor(
        AppController.prototype,
        'live',
      )!.value as object;
      const readiness = Object.getOwnPropertyDescriptor(
        AppController.prototype,
        'readiness',
      )!.value as object;

      expect(Reflect.getMetadata(PATH_METADATA, AppController)).toBe('health');
      expect(Reflect.getMetadata(PATH_METADATA, live)).toBe('live');
      expect(Reflect.getMetadata(PATH_METADATA, readiness)).toBe('/');
      expect(Reflect.getMetadata(METHOD_METADATA, live)).toBe(
        RequestMethod.GET,
      );
      expect(Reflect.getMetadata(METHOD_METADATA, readiness)).toBe(
        RequestMethod.GET,
      );
    });

    it('marks both endpoints public, so no token is needed', () => {
      for (const name of ['live', 'readiness'] as const) {
        const handler = Object.getOwnPropertyDescriptor(
          AppController.prototype,
          name,
        )!.value as object;
        expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
      }
    });
  });
});
