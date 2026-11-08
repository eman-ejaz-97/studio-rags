import { readMailConfig } from './mail.config';
import { createMailTransport } from './mail.transport';
import {
  MEMORY_OUTBOX_LIMIT,
  MemoryMailTransport,
} from './transports/memory.transport';
import { ResendMailTransport } from './transports/resend.transport';
import { SmtpMailTransport } from './transports/smtp.transport';

describe('createMailTransport', () => {
  it('builds SMTP for MAIL_TRANSPORT=smtp', () => {
    const transport = createMailTransport(
      readMailConfig({ MAIL_TRANSPORT: 'smtp' }),
    );

    expect(transport).toBeInstanceOf(SmtpMailTransport);
    expect(transport.name).toBe('smtp');
    transport.close?.();
  });

  it('builds Resend for MAIL_TRANSPORT=resend', () => {
    const transport = createMailTransport(
      readMailConfig({
        MAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 're_test_key',
        MAIL_FROM: 'Studio Rags <onboarding@resend.dev>',
        MAIL_ALLOWED_RECIPIENTS: 'developer@example.com',
      }),
    );

    expect(transport).toBeInstanceOf(ResendMailTransport);
    expect(transport.name).toBe('resend');
  });

  it('builds the in-memory outbox for MAIL_TRANSPORT=memory', () => {
    const transport = createMailTransport(
      readMailConfig({ MAIL_TRANSPORT: 'memory' }),
    );

    expect(transport).toBeInstanceOf(MemoryMailTransport);
    expect(transport.name).toBe('memory');
  });
});

describe('MemoryMailTransport', () => {
  const email = (n: number) => ({
    emailLogId: `email_${n}`,
    from: 'Studio Rags <hello@studiorags.com.au>',
    to: 'ada@example.com',
    subject: 'Subject',
    html: '<p>Hi</p>',
    text: 'Hi',
  });

  it('keeps each message and names it after its row', async () => {
    const transport = new MemoryMailTransport();

    await expect(transport.send(email(1))).resolves.toEqual({
      messageId: 'memory-email_1',
    });
    expect(transport.sent).toEqual([email(1)]);
  });

  it('keeps only the most recent messages', async () => {
    const transport = new MemoryMailTransport();

    for (let n = 1; n <= MEMORY_OUTBOX_LIMIT + 2; n++) {
      await transport.send(email(n));
    }

    expect(transport.sent).toHaveLength(MEMORY_OUTBOX_LIMIT);
    expect(transport.sent[0].emailLogId).toBe('email_3');
  });
});
