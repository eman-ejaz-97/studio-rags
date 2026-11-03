import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { STORAGE_CONFIG, readStorageConfig } from './storage.config';
import { StorageService } from './storage.service';

/**
 * Global, like PrismaModule: workshops, reviews and the admin console will all
 * need storage, and re-importing it in each feature module adds nothing.
 */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE_CONFIG,
      // Runs while the app is being created, so a half-configured storage
      // block stops the deploy here rather than on the first upload.
      useFactory: (config: ConfigService) =>
        readStorageConfig((name) => config.get<string>(name)),
      inject: [ConfigService],
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
