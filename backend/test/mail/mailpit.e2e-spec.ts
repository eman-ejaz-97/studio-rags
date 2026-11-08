import { EmailStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  readMailConfig,
  type SmtpMailConfig,
} from '../../src/mail/mail.config';
import { MailService } from '../../src/mail/mail.service';
import { EMAIL_LOG_HEADER } from '../../src/mail/mail.transport';
import { SmtpMailTransport } from '../../src/mail/transports/smtp.transport';
import { useTestApp } from '../utils/test-app';

/**
 * A real send over SMTP into the local Mailpit container, read back through
 * Mailpit's API. Needs Mailpit running (docker compose up mailpit), so it
 * only runs through `npm run test:mailpit`, which sets MAILPIT_URL. In the
 * ordinary e2e run and in CI it is skipped.
 */
const MAILPIT_URL = process.env.MAILPIT_URL;
const describeWithMailpit = MAILPIT_URL ? describe : describe.skip;

interface MailpitSummary {
  ID: string;
}

interface MailpitMessage {
  ID: string;
  MessageID: string;
  From: { Name: string; Address: string };
  To: { Name: string; Address: string }[];
  Subject: string;
  Text: string;
  HTML: string;
}

async function mailpit<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${MAILPIT_URL}/api/v1${path}`, init);
  if (!res.ok) throw new Error(`Mailpit ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

describeWithMailpit('sending through Mailpit', () => {
  const ctx = useTestApp();
  const delivered: string[] = [];

  afterAll(async () => {
    // Leave the developer's local inbox as it was.
    if (delivered.length > 0) {
      await fetch(`${MAILPIT_URL}/api/v1/messages`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ IDs: delivered }),
      });
    }
  });

  it('delivers a password-reset email that Mailpit can read back', async () => {
    const t = ctx();
    const smtp = readMailConfig({
      MAIL_TRANSPORT: 'smtp',
      MAIL_HOST: new URL(MAILPIT_URL ?? '').hostname,
      MAIL_PORT: process.env.MAILPIT_SMTP_PORT ?? '1025',
    }) as SmtpMailConfig;
    const transport = new SmtpMailTransport(smtp);
    const service = new MailService(t.prisma, t.config, smtp, transport);
    // A fresh address, so this message cannot be confused with another.
    const to = `mailpit-${randomUUID()}@example.com`;
    const resetUrl = `http://localhost:3000/reset-password?token=${randomUUID()}`;

    const outcome = await service.sendPasswordReset({
      to,
      firstName: 'Ada',
      resetUrl,
      expiresInMinutes: 60,
    });
    transport.close();

    expect(outcome.status).toBe('sent');
    const row = await t.prisma.emailLog.findFirstOrThrow({ where: { to } });
    expect(row.status).toBe(EmailStatus.SENT);

    const found = await mailpit<{ messages: MailpitSummary[] }>(
      `/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    );
    expect(found.messages).toHaveLength(1);
    const id = found.messages[0].ID;
    delivered.push(id);

    const message = await mailpit<MailpitMessage>(`/message/${id}`);
    expect(message.Subject).toBe('Reset your Studio Rags password');
    expect(message.From).toEqual({
      Name: 'Studio Rags',
      Address: 'hello@studiorags.com.au',
    });
    expect(message.To.map((r) => r.Address)).toEqual([to]);
    expect(message.Text).toContain(resetUrl);
    expect(message.HTML).toContain(resetUrl);
    // email_logs names the message Mailpit holds, and the message names its row.
    expect(row.providerMessageId).toBe(`<${message.MessageID}>`);
    const headers = await mailpit<Record<string, string[]>>(
      `/message/${id}/headers`,
    );
    expect(headers[EMAIL_LOG_HEADER]).toEqual([row.id]);
  });
});
