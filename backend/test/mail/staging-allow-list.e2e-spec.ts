// Must stay the first import: it sets MAIL_ALLOWED_RECIPIENTS before
// AppModule is imported. See the module for why.
import { ALLOWED_RECIPIENT } from './support/allow-list';
import { EmailStatus } from '@prisma/client';
import { MAIL_TRANSPORT } from '../../src/mail/mail.transport';
import { MailService, SUPPRESSED_REASON } from '../../src/mail/mail.service';
import { MemoryMailTransport } from '../../src/mail/transports/memory.transport';
import { AUTH, register } from '../utils/auth';
import { useTestApp } from '../utils/test-app';

/**
 * The staging shape (ADR-040): only the Resend account owner may receive
 * real mail. Anyone else still gets the reset link issued and an email_logs
 * row, marked SUPPRESSED, but no provider call.
 */
describe('staging allow-list (MAIL_ALLOWED_RECIPIENTS)', () => {
  const ctx = useTestApp();

  const outbox = () => ctx().app.get<MemoryMailTransport>(MAIL_TRANSPORT);
  const mail = () => ctx().app.get(MailService);

  const forgot = (email: string) =>
    ctx().http().post(`${AUTH}/forgot-password`).send({ email });

  beforeEach(() => {
    outbox().clear();
  });

  it('runs with the allow-list configured', () => {
    expect(ctx().config.get('MAIL_ALLOWED_RECIPIENTS')).toBe(ALLOWED_RECIPIENT);
  });

  it('records mail to anyone else as SUPPRESSED and sends nothing', async () => {
    const t = ctx();
    await register(t, { email: 'customer@example.com' });

    await forgot('customer@example.com').expect(202);
    await mail().whenIdle();

    expect(outbox().sent).toHaveLength(0);
    const rows = await t.prisma.emailLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      to: 'customer@example.com',
      template: 'password-reset',
      status: EmailStatus.SUPPRESSED,
      error: SUPPRESSED_REASON,
      providerMessageId: null,
      sentAt: null,
    });
    // The flow itself completed: the link exists, only the email was held.
    await expect(t.prisma.passwordResetToken.count()).resolves.toBe(1);
  });

  it('sends to the allowed address', async () => {
    const t = ctx();
    await register(t, { email: ALLOWED_RECIPIENT });

    await forgot(ALLOWED_RECIPIENT).expect(202);
    await mail().whenIdle();

    expect(outbox().sent).toHaveLength(1);
    await expect(t.prisma.emailLog.findFirstOrThrow()).resolves.toMatchObject({
      to: ALLOWED_RECIPIENT,
      status: EmailStatus.SENT,
    });
  });
});
