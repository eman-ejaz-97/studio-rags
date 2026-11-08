import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAIL_CONFIG, type MailConfig, readMailConfig } from './mail.config';
import { MAIL_TRANSPORT, createMailTransport } from './mail.transport';
import { MailService } from './mail.service';

/**
 * Imported by each module that sends email (auth now, payments next), rather
 * than global like PrismaModule. That is deliberate: Nest shuts global modules
 * down last, so a non-global MailService finishes its sends in flight before
 * PrismaService closes the connection their rows are written over.
 */
@Module({
  providers: [
    {
      provide: MAIL_CONFIG,
      // Runs while the app is being created, so a broken mail setup stops
      // the deploy here rather than at the first email.
      useFactory: (config: ConfigService) =>
        readMailConfig((name) => config.get<string>(name)),
      inject: [ConfigService],
    },
    {
      provide: MAIL_TRANSPORT,
      useFactory: (config: MailConfig) => createMailTransport(config),
      inject: [MAIL_CONFIG],
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
