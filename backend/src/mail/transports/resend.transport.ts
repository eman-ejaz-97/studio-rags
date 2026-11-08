import {
  EMAIL_LOG_HEADER,
  type MailTransport,
  type OutgoingEmail,
} from '../mail.transport';

export const RESEND_API_URL = 'https://api.resend.com/emails';
/** Long enough for a slow answer from Singapore, short enough to free the row. */
export const RESEND_TIMEOUT_MS = 10_000;

/**
 * Resend's HTTP API, called with fetch: one endpoint, so the SDK would add a
 * dependency and little else, and calling it directly keeps the timeout and
 * the error text in our hands.
 *
 * On the free plan without a verified domain, Resend only delivers to the
 * account owner's own address and only from onboarding@resend.dev. MailService
 * applies the allow-list before this is ever called (ADR-040).
 */
export class ResendMailTransport implements MailTransport {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(email: OutgoingEmail): Promise<{ messageId: string }> {
    let res: Response;
    try {
      res = await this.fetchImpl(RESEND_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // Resend rejects requests without one, with a 403.
          'User-Agent': 'studio-rags-api',
          // One row, one email: should this row ever be sent again, Resend
          // answers from its record for 24 hours instead of sending twice.
          'Idempotency-Key': `email-log/${email.emailLogId}`,
        },
        body: JSON.stringify({
          from: email.from,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
          headers: { [EMAIL_LOG_HEADER]: email.emailLogId },
        }),
        signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
      });
    } catch (err) {
      // A timeout means no answer, not a refusal: Resend may still have sent
      // it, and the error says so rather than claiming it was lost.
      // Checked by name: the abort arrives as a DOMException, which is not
      // always an instanceof this realm's Error.
      if (field(err, 'name') === 'TimeoutError') {
        throw new Error(
          `No answer from Resend within ${RESEND_TIMEOUT_MS / 1000} seconds; ` +
            'the email may or may not have been sent',
        );
      }
      throw new Error(`Could not reach Resend: ${messageOf(err)}`);
    }

    const body = await readJson(res);

    if (!res.ok) {
      // Resend's error body is { statusCode, name, message }. The name alone
      // is ambiguous (validation_error covers several cases), so keep both.
      const name = field(body, 'name');
      const message = field(body, 'message') ?? res.statusText;
      throw new Error(
        `Resend refused the email (HTTP ${res.status}${name ? ` ${name}` : ''}): ${message}`,
      );
    }

    const id = field(body, 'id');
    if (!id) {
      throw new Error(
        `Resend answered HTTP ${res.status} but gave no email id; check the Resend dashboard`,
      );
    }
    return { messageId: id };
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** A non-empty string property of a JSON body or an error, if there is one. */
function field(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === 'string' && found !== '' ? found : undefined;
}

function messageOf(err: unknown): string {
  const message = field(err, 'message');
  if (!message) return String(err);
  // fetch reports network failures as "fetch failed" and puts the reason
  // (ENOTFOUND, ECONNRESET...) on cause.
  const cause = field((err as { cause?: unknown }).cause, 'message');
  return cause ? `${message}: ${cause}` : message;
}
