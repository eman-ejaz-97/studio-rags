import { Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  // Constructing the client opens nothing; only $connect does. These tests
  // stub both, so they run without a database.
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = new PrismaService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('connects when the module starts', async () => {
    const connect = jest.spyOn(prisma, '$connect').mockResolvedValue();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    await prisma.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('disconnects when the module is destroyed, so app.close() frees the pool', async () => {
    const disconnect = jest.spyOn(prisma, '$disconnect').mockResolvedValue();

    await prisma.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('waits for the disconnect to finish before reporting the module closed', async () => {
    let finished = false;
    jest.spyOn(prisma, '$disconnect').mockImplementation(async () => {
      await new Promise((resolve) => setImmediate(resolve));
      finished = true;
    });

    await prisma.onModuleDestroy();

    expect(finished).toBe(true);
  });
});
