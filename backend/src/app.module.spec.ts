import type { ConfigModuleOptions } from '@nestjs/config';

/**
 * ConfigModule.forRoot() runs while app.module.ts is first evaluated, so each
 * test loads a fresh copy of the module graph and records the options it was
 * given. forRoot itself is stubbed: the real one would read ../.env into this
 * worker's process.env, which is the very leak under test.
 */
function configOptionsUnder(nodeEnv: string): ConfigModuleOptions {
  const saved = process.env.NODE_ENV;
  setNodeEnv(nodeEnv);

  try {
    let options: ConfigModuleOptions | undefined;
    // requireActual inside isolateModules loads from the isolated registry,
    // so the ConfigModule spied on here is the one app.module.ts receives.
    jest.isolateModules(() => {
      const { ConfigModule } =
        jest.requireActual<typeof import('@nestjs/config')>('@nestjs/config');
      jest.spyOn(ConfigModule, 'forRoot').mockImplementation((given) => {
        options = given;
        return Promise.resolve({ module: class StubConfigModule {} });
      });
      jest.requireActual('./app.module');
    });
    if (!options) throw new Error('AppModule never called forRoot()');
    return options;
  } finally {
    setNodeEnv(saved);
  }
}

// Assigning undefined to process.env stores the string "undefined".
function setNodeEnv(value: string | undefined): void {
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
}

describe('AppModule configuration', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('ignores every env file under NODE_ENV=test, so the dev secrets in ../.env never reach a test', () => {
    expect(configOptionsUnder('test')).toMatchObject({
      ignoreEnvFile: true,
    });
  });

  it.each(['development', 'production'])(
    'reads ../.env then .env under NODE_ENV=%s',
    (nodeEnv) => {
      expect(configOptionsUnder(nodeEnv)).toMatchObject({
        ignoreEnvFile: false,
        envFilePath: ['../.env', '.env'],
      });
    },
  );
});
