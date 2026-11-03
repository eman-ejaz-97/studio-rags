import {
  INestApplication,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  /**
   * Release the connection pool when the app closes. Without this the pool
   * outlives app.close(): a Jest worker waits on its open connections after
   * the last test, and on Neon they hold pooler slots until they time out.
   */
  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Close the Nest app cleanly when the process is asked to stop, so in-flight
   * transactions are not cut off mid-write.
   */
  enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', () => {
      void app.close();
    });
  }
}
