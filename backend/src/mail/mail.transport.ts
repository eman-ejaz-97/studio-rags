import type { MailConfig, MailTransportName } from './mail.config';
import { MemoryMailTransport } from './transports/memory.transport';
import { ResendMailTransport } from './transports/resend.transport';
import { SmtpMailTransport } from './transports/smtp.transport';

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** One rendered message, ready to hand to a provider. */
export interface OutgoingEmail {
  /** The email_logs row this send is recorded in. */
  emailLogId: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Whatever actually delivers mail. MailService owns the allow-list and the
 * email_logs row; a transport only sends, and either resolves with the
 * provider's id for the message or rejects with an error worth reading in
 * email_logs.error.
 */
export interface MailTransport {
  readonly name: MailTransportName;
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
  /** Releases sockets on shutdown, where the transport holds any. */
  close?(): void;
}

/** Sent with every message, so a delivered email can be traced to its row. */
export const EMAIL_LOG_HEADER = 'X-Studio-Rags-Email-Log';

export function createMailTransport(config: MailConfig): MailTransport {
  switch (config.transport) {
    case 'smtp':
      return new SmtpMailTransport(config);
    case 'resend':
      return new ResendMailTransport(config.apiKey);
    case 'memory':
      return new MemoryMailTransport();
  }
}
