import { Logger } from '@nestjs/common';
import { EmailStatus } from '@prisma/client';
import { MAIL_TRANSPORT } from '../../src/mail/mail.transport';
import { MailService } from '../../src/mail/mail.service';
import { MemoryMailTransport } from '../../src/mail/transports/memory.transport';
import { AUTH, login, register, sha256 } from '../utils/auth';
import { useTestApp } from '../utils/test-app';

const NEW_PASSWORD = 'a-brand-new-passphrase';

/**
 * Forgot-password through the real app, with .env.test's in-memory outbox in
 * place of a mail provider. The emails are read back from that outbox, and
 * their email_logs rows from the test database.
 */
describe('password reset email', () => {
  const ctx = useTestApp();

  const outbox = () => ctx().app.get<MemoryMailTransport>(MAIL_TRANSPORT);
  const mail = () => ctx().app.get(MailService);

  const forgot = (email: string) =>
    ctx().http().post(`${AUTH}/forgot-password`).send({ email });

  beforeEach(() => {
    outbox().clear();
  });

  it('runs on the in-memory outbox, so nothing can leave the machine', () => {
    expect(outbox()).toBeInstanceOf(MemoryMailTransport);
  });

  it('emails an existing account and records the send in email_logs', async () => {
    const t = ctx();
    await register(t);

    await forgot('ada@example.com').expect(202);
    await mail().whenIdle();

    const rows = await t.prisma.emailLog.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      to: 'ada@example.com',
      template: 'password-reset',
      subject: 'Reset your Studio Rags password',
      bookingId: null,
      status: EmailStatus.SENT,
      providerMessageId: `memory-${rows[0].id}`,
      error: null,
    });
    expect(rows[0].sentAt).toBeInstanceOf(Date);

    expect(outbox().sent).toHaveLength(1);
    expect(outbox().sent[0]).toMatchObject({
      emailLogId: rows[0].id,
      to: 'ada@example.com',
      subject: 'Reset your Studio Rags password',
    });
  });

  it('sends a link that really resets the password', async () => {
    const t = ctx();
    await register(t);

    await forgot('ada@example.com').expect(202);
    await mail().whenIdle();

    // The link as the customer would read it in the plain-text part.
    const [email] = outbox().sent;
    const link = /(http:\/\/\S+\/reset-password\?token=\S+)/.exec(
      email.text,
    )?.[1];
    expect(link).toBeDefined();
    const token = new URL(link ?? '').searchParams.get('token') ?? '';
    expect(email.html).toContain(token);

    const stored = await t.prisma.passwordResetToken.findFirstOrThrow();
    expect(sha256(token)).toBe(stored.tokenHash);

    await t
      .http()
      .post(`${AUTH}/reset-password`)
      .send({ token, password: NEW_PASSWORD })
      .expect(200);
    await login(t, 'ada@example.com', NEW_PASSWORD);
  });

  it('writes nothing for an unknown address, and answers exactly as for a known one', async () => {
    const t = ctx();
    await register(t);

    const known = await forgot('ada@example.com').expect(202);
    await mail().whenIdle();
    await t.prisma.emailLog.deleteMany();
    outbox().clear();

    const unknown = await forgot('nobody@example.com').expect(202);
    await mail().whenIdle();

    expect(unknown.body).toEqual(known.body);
    expect(unknown.headers['content-type']).toBe(known.headers['content-type']);
    await expect(t.prisma.emailLog.count()).resolves.toBe(0);
    expect(outbox().sent).toHaveLength(0);
  });

  it('still answers 202 when the provider fails, and records the failure', async () => {
    const t = ctx();
    await register(t);
    jest
      .spyOn(outbox(), 'send')
      .mockRejectedValue(
        new Error('Resend refused the email (HTTP 500): Internal error'),
      );
    // Expected here, so kept out of the run's output.
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});

    const res = await forgot('ada@example.com');
    await mail().whenIdle();

    expect(res.status).toBe(202);
    expect(logged).toHaveBeenCalledTimes(1);
    const row = await t.prisma.emailLog.findFirstOrThrow();
    expect(row).toMatchObject({
      status: EmailStatus.FAILED,
      error: 'Resend refused the email (HTTP 500): Internal error',
      providerMessageId: null,
      sentAt: null,
    });
    // The reset link itself was still issued; asking again sends a new one.
    await expect(t.prisma.passwordResetToken.count()).resolves.toBe(1);
  });
});
