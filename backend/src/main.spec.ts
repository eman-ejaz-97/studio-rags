/**
 * main.ts boots the server as soon as it is imported, so everything it would
 * reach for is replaced first (jest.mock calls run before the imports below).
 * What is left to observe is the one thing this file decides: the address it
 * listens on.
 *
 * HOST is deliberately not the default here, so a listen() that ignored it
 * and fell back to Node's own default would fail the test.
 */
jest.mock('@nestjs/core', () => {
  const settings: Record<string, unknown> = {
    PORT: 10000,
    HOST: '127.0.0.1',
  };
  const app = {
    // Stands in for both ConfigService and PrismaService, the only two
    // things main.ts asks the container for.
    get: () => ({
      get: (key: string) => settings[key],
      enableShutdownHooks: jest.fn(),
    }),
    enableShutdownHooks: jest.fn(),
    listen: jest.fn(() => Promise.resolve()),
  };
  return { NestFactory: { create: jest.fn(() => Promise.resolve(app)) } };
});
jest.mock('@nestjs/common', () => ({
  ...jest.requireActual<object>('@nestjs/common'),
  // Silences the "API listening" line.
  Logger: class {
    log() {}
  },
}));
jest.mock('./app.module', () => ({ AppModule: class AppModule {} }));
jest.mock('./app.setup', () => ({ configureApp: jest.fn() }));
jest.mock('./prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import './main';

interface FakeApp {
  listen: jest.Mock<Promise<void>, [number, string]>;
}

const { create } = jest.requireMock<{
  NestFactory: { create: jest.Mock<Promise<FakeApp>> };
}>('@nestjs/core').NestFactory;

describe('main.ts bootstrap', () => {
  it('listens on the configured PORT and HOST', async () => {
    // bootstrap() is fire-and-forget; let its awaits settle.
    await new Promise((resolve) => setImmediate(resolve));

    expect(create).toHaveBeenCalledTimes(1);
    const app = await (create.mock.results[0].value as Promise<FakeApp>);

    // Render routes to PORT on 0.0.0.0 only; a server left on its default
    // address there is never reached.
    expect(app.listen).toHaveBeenCalledWith(10000, '127.0.0.1');
  });
});
