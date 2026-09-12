import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';

describe('AppController', () => {
  let controller: AppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
          },
        },
      ],
    }).compile();

    controller = module.get<AppController>(AppController);
  });

  it('reports ok when the database answers', async () => {
    await expect(controller.health()).resolves.toMatchObject({
      status: 'ok',
      database: 'up',
      service: 'studio-rags-api',
    });
  });

  it('reports degraded when the database does not answer', async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockRejectedValue(new Error('down')),
          },
        },
      ],
    }).compile();

    await expect(
      module.get<AppController>(AppController).health(),
    ).resolves.toMatchObject({
      status: 'degraded',
      database: 'down',
    });
  });
});
