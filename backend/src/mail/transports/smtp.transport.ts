import { createTransport, type Transporter } from 'nodemailer';
import type { SmtpMailConfig } from '../mail.config';
import {
  EMAIL_LOG_HEADER,
  type MailTransport,
  type OutgoingEmail,
} from '../mail.transport';

/**
 * Nodemailer's defaults wait up to two minutes for a connection and ten for
 * an idle socket. A send that hangs that long holds its email_logs row at
 * QUEUED and delays shutdown, so these are much shorter.
 */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const;

/**
 * Plain SMTP. Locally that is Mailpit on localhost:1025, which accepts
 * everything and delivers nothing, so no email can reach a real inbox from a
 * developer's machine. Any SMTP provider works the same way through MAIL_HOST
 * and friends.
 */
export class SmtpMailTransport implements MailTransport {
  readonly name = 'smtp';
  private readonly transporter: Transporter;

  constructor(config: SmtpMailConfig, create = createTransport) {
    this.transporter = create({
      host: config.host,
      port: config.port,
      // Port 465 speaks TLS from the first byte. Any other port starts plain
      // and upgrades with STARTTLS when the server offers it.
      secure: config.port === 465,
      auth: config.auth,
      ...SMTP_TIMEOUTS,
    });
  }

  async send(email: OutgoingEmail): Promise<{ messageId: string }> {
    const info = (await this.transporter.sendMail({
      from: email.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: { [EMAIL_LOG_HEADER]: email.emailLogId },
    })) as { messageId?: unknown };

    if (typeof info.messageId !== 'string' || info.messageId === '') {
      throw new Error(
        'Nodemailer reported the email sent but gave no Message-ID',
      );
    }
    return { messageId: info.messageId };
  }

  close(): void {
    this.transporter.close();
  }
}
