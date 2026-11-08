import type { createTransport } from 'nodemailer';
import type { SmtpMailConfig } from '../mail.config';
import { EMAIL_LOG_HEADER, type OutgoingEmail } from '../mail.transport';
import { SMTP_TIMEOUTS, SmtpMailTransport } from './smtp.transport';

const EMAIL: OutgoingEmail = {
  emailLogId: 'email_1',
  from: 'Studio Rags <hello@studiorags.com.au>',
  to: 'ada@example.com',
  subject: 'Reset your Studio Rags password',
  html: '<p>Hello</p>',
  text: 'Hello',
};

const MAILPIT: SmtpMailConfig = {
  transport: 'smtp',
  host: 'localhost',
  port: 1025,
  from: EMAIL.from,
  allowedRecipients: null,
};

/** Stands in for nodemailer.createTransport; no socket is ever opened. */
function fakeNodemailer(sendMail: jest.Mock) {
  const close = jest.fn();
  const create = jest.fn(() => ({ sendMail, close }));
  return {
    create: create as unknown as typeof createTransport,
    createMock: create,
    close,
  };
}

describe('SmtpMailTransport', () => {
  it('connects to Mailpit in the clear, with short timeouts', () => {
    const { create, createMock } = fakeNodemailer(jest.fn());

    new SmtpMailTransport(MAILPIT, create);

    expect(createMock).toHaveBeenCalledWith({
      host: 'localhost',
      port: 1025,
      secure: false,
      auth: undefined,
      ...SMTP_TIMEOUTS,
    });
  });

  it('uses TLS from the start on port 465, and signs in when given a user', () => {
    const { create, createMock } = fakeNodemailer(jest.fn());

    new SmtpMailTransport(
      { ...MAILPIT, port: 465, auth: { user: 'u', pass: 'p' } },
      create,
    );

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: true,
        auth: { user: 'u', pass: 'p' },
      }),
    );
  });

  it('sends both parts, tagged with the email_logs row, and returns the Message-ID', async () => {
    const sendMail = jest
      .fn()
      .mockResolvedValue({ messageId: '<abc@studiorags.com.au>' });
    const { create } = fakeNodemailer(sendMail);
    const transport = new SmtpMailTransport(MAILPIT, create);

    await expect(transport.send(EMAIL)).resolves.toEqual({
      messageId: '<abc@studiorags.com.au>',
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: EMAIL.from,
      to: EMAIL.to,
      subject: EMAIL.subject,
      html: EMAIL.html,
      text: EMAIL.text,
      headers: { [EMAIL_LOG_HEADER]: 'email_1' },
    });
  });

  it("passes the server's refusal on", async () => {
    const sendMail = jest
      .fn()
      .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:1025'));
    const { create } = fakeNodemailer(sendMail);
    const transport = new SmtpMailTransport(MAILPIT, create);

    await expect(transport.send(EMAIL)).rejects.toThrow(
      'connect ECONNREFUSED 127.0.0.1:1025',
    );
  });

  it('closes its connections on shutdown', () => {
    const { create, close } = fakeNodemailer(jest.fn());
    const transport = new SmtpMailTransport(MAILPIT, create);

    transport.close();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
