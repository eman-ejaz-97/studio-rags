import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from './app.setup';

/**
 * A stand-in app that records what configureApp asks of it. The e2e suite
 * proves the effect on real requests; this pins the decision itself.
 */
function fakeApp(env: Record<string, unknown>) {
  const config = {
    get: (key: string) => env[key],
    getOrThrow: (key: string) => {
      if (env[key] === undefined) throw new TypeError(`missing ${key}`);
      return env[key];
    },
  } as unknown as ConfigService;

  const app = {
    get: jest.fn(() => config),
    set: jest.fn(),
    use: jest.fn(),
    enableCors: jest.fn(),
    setGlobalPrefix: jest.fn(),
    useGlobalPipes: jest.fn(),
  };
  return app;
}

const BASE = { CORS_ORIGIN: 'http://localhost:3000' };

describe('configureApp', () => {
  describe('trust proxy', () => {
    it.each([
      ['unset', undefined],
      ['0', 0],
    ])(
      'leaves X-Forwarded-For untrusted when TRUST_PROXY is %s',
      (_label, hops) => {
        const app = fakeApp({ ...BASE, TRUST_PROXY: hops });

        configureApp(app as unknown as NestExpressApplication);

        expect(app.set).not.toHaveBeenCalled();
      },
    );

    it.each([1, 2])('trusts exactly %d hop(s) when configured', (hops) => {
      const app = fakeApp({ ...BASE, TRUST_PROXY: hops });

      configureApp(app as unknown as NestExpressApplication);

      // A number, never `true`: Express reads true as "trust every hop",
      // which would let a client pick its own req.ip.
      expect(app.set).toHaveBeenCalledTimes(1);
      expect(app.set).toHaveBeenCalledWith('trust proxy', hops);
    });
  });

  it('serves under /api/v1 with credentialed CORS for the one configured origin', () => {
    const app = fakeApp(BASE);

    configureApp(app as unknown as NestExpressApplication);

    expect(app.setGlobalPrefix).toHaveBeenCalledWith('api/v1');
    expect(app.enableCors).toHaveBeenCalledWith({
      origin: 'http://localhost:3000',
      credentials: true,
    });
    expect(app.useGlobalPipes).toHaveBeenCalledWith(expect.any(ValidationPipe));
  });
});
