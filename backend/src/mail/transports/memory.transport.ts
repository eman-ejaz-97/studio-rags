import type { MailTransport, OutgoingEmail } from '../mail.transport';

/** How many messages the outbox keeps before dropping the oldest. */
export const MEMORY_OUTBOX_LIMIT = 50;

/**
 * Delivers nothing: each message is kept in memory, where a test can read
 * it back (the reset link inside a password-reset email, for instance).
 * readMailConfig refuses it under NODE_ENV=production, because it reports
 * every message as sent.
 */
export class MemoryMailTransport implements MailTransport {
  readonly name = 'memory';
  readonly sent: OutgoingEmail[] = [];

  send(email: OutgoingEmail): Promise<{ messageId: string }> {
    this.sent.push(email);
    // Bounded, so a long-running process on this transport cannot grow
    // without limit.
    if (this.sent.length > MEMORY_OUTBOX_LIMIT) this.sent.shift();
    return Promise.resolve({ messageId: `memory-${email.emailLogId}` });
  }

  clear(): void {
    this.sent.length = 0;
  }
}
