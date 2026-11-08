/**
 * Mail settings, read once at boot:
 *
 *   MAIL_TRANSPORT   smtp (Mailpit locally), resend (staging), or memory
 *                    (tests: nothing leaves the process). Defaults to smtp,
 *                    except under NODE_ENV=production, where it must be set.
 *   MAIL_FROM        the sender. Required for resend, whose free plan only
 *                    sends from onboarding@resend.dev until a domain is
 *                    verified.
 *   MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASSWORD
 *                    smtp only. Default localhost:1025, Mailpit's port.
 *   RESEND_API_KEY   resend only, and required there.
 *   MAIL_ALLOWED_RECIPIENTS
 *                    comma-separated addresses that may receive real mail,
 *                    or * for anyone. Everyone else gets an email_logs row
 *                    marked SUPPRESSED and no provider call (ADR-040).
 *                    Required for resend, so a staging deploy that forgot it
 *                    stops at boot instead of mailing whoever signs up.
 *                    Optional for smtp: unset, Mailpit catches everything.
 *
 * Every mistake here stops the process at boot with a message naming the
 * variable, never its value: a deploy with a broken mail setup should fail
 * loudly, not come up healthy and lose the first confirmation email.
 */

export const MAIL_CONFIG = Symbol('MAIL_CONFIG');

export const MAIL_TRANSPORTS = ['smtp', 'resend', 'memory'] as const;
export type MailTransportName = (typeof MAIL_TRANSPORTS)[number];

export const DEFAULT_MAIL_FROM = 'Studio Rags <hello@studiorags.com.au>';
export const DEFAULT_SMTP_HOST = 'localhost';
export const DEFAULT_SMTP_PORT = 1025;

interface CommonMailConfig {
  from: string;
  /**
   * Lower-cased addresses that may receive real mail. Null means anyone:
   * the variable is unset (smtp, memory) or set to * (resend with a
   * verified domain).
   */
  allowedRecipients: ReadonlySet<string> | null;
}

export interface SmtpMailConfig extends CommonMailConfig {
  transport: 'smtp';
  host: string;
  port: number;
  auth?: { user: string; pass: string };
}

export interface ResendMailConfig extends CommonMailConfig {
  transport: 'resend';
  apiKey: string;
}

export interface MemoryMailConfig extends CommonMailConfig {
  transport: 'memory';
}

export type MailConfig = SmtpMailConfig | ResendMailConfig | MemoryMailConfig;

export type EnvLookup = (name: string) => string | undefined;

export class MailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailConfigError';
  }
}

/** An address, bare or in "Name <address>" form. Deliberately loose. */
const ADDRESS = /^[^\s@<>,]+@[^\s@<>,]+\.[^\s@<>,]+$/;
const NAMED_ADDRESS = /^[^<>]*<([^<>]+)>$/;

export function readMailConfig(
  source: EnvLookup | Record<string, string | undefined>,
): MailConfig {
  const lookup: EnvLookup =
    typeof source === 'function' ? source : (name) => source[name];

  // An empty value counts as unset, as in storage.config.ts: a KEY= line
  // copied from .env.example should not count as a setting.
  const read = (name: string): string | undefined => {
    const value = lookup(name)?.trim();
    return value ? value : undefined;
  };

  const isProduction = read('NODE_ENV') === 'production';
  const transport = readTransport(read('MAIL_TRANSPORT'), isProduction);

  const from = read('MAIL_FROM');
  if (from !== undefined && !isSenderAddress(from)) {
    throw new MailConfigError(
      'MAIL_FROM must be an email address, bare or as "Name <address>", ' +
        'e.g. "Studio Rags <onboarding@resend.dev>".',
    );
  }

  const allowedRecipients = readAllowList(read('MAIL_ALLOWED_RECIPIENTS'));

  switch (transport) {
    case 'resend': {
      const apiKey = read('RESEND_API_KEY');
      if (!apiKey) {
        throw new MailConfigError(
          'RESEND_API_KEY is required when MAIL_TRANSPORT=resend. Create one ' +
            'in the Resend dashboard (API Keys, "Sending access").',
        );
      }
      if (!apiKey.startsWith('re_')) {
        throw new MailConfigError(
          'RESEND_API_KEY does not look like a Resend key; they start with "re_".',
        );
      }
      if (!from) {
        throw new MailConfigError(
          'MAIL_FROM is required when MAIL_TRANSPORT=resend. Without a ' +
            'verified domain Resend only sends from onboarding@resend.dev, ' +
            'so use "Studio Rags <onboarding@resend.dev>".',
        );
      }
      if (allowedRecipients === undefined) {
        throw new MailConfigError(
          'MAIL_ALLOWED_RECIPIENTS is required when MAIL_TRANSPORT=resend. ' +
            "On staging set it to the Resend account owner's address " +
            '(ADR-040); set it to * only once a domain is verified and mail ' +
            'to anyone is intended.',
        );
      }
      return { transport, apiKey, from, allowedRecipients };
    }

    case 'smtp': {
      const user = read('MAIL_USER');
      const pass = read('MAIL_PASSWORD');
      if (Boolean(user) !== Boolean(pass)) {
        throw new MailConfigError(
          'MAIL_USER and MAIL_PASSWORD go together: set both, or neither for ' +
            'a server without sign-in such as Mailpit.',
        );
      }
      return {
        transport,
        host: read('MAIL_HOST') ?? DEFAULT_SMTP_HOST,
        port: readPort(read('MAIL_PORT')),
        auth: user && pass ? { user, pass } : undefined,
        from: from ?? DEFAULT_MAIL_FROM,
        allowedRecipients: allowedRecipients ?? null,
      };
    }

    case 'memory':
      return {
        transport,
        from: from ?? DEFAULT_MAIL_FROM,
        allowedRecipients: allowedRecipients ?? null,
      };
  }
}

function readTransport(
  value: string | undefined,
  isProduction: boolean,
): MailTransportName {
  if (value === undefined) {
    if (isProduction) {
      throw new MailConfigError(
        'MAIL_TRANSPORT must be set when NODE_ENV=production: resend on ' +
          'staging, or smtp for another provider.',
      );
    }
    return 'smtp';
  }

  const name = value.toLowerCase();
  if (!(MAIL_TRANSPORTS as readonly string[]).includes(name)) {
    throw new MailConfigError(
      `MAIL_TRANSPORT must be one of ${MAIL_TRANSPORTS.join(', ')}.`,
    );
  }

  // memory reports every message as sent while delivering none. On a real
  // deploy that would make email_logs claim confirmations went out.
  if (name === 'memory' && isProduction) {
    throw new MailConfigError(
      'MAIL_TRANSPORT=memory is for tests and is refused when ' +
        'NODE_ENV=production: it delivers nothing.',
    );
  }

  return name as MailTransportName;
}

/**
 * Undefined when unset, null for *, otherwise the lower-cased addresses.
 * Undefined and null are kept apart so resend can insist on a decision.
 */
function readAllowList(
  value: string | undefined,
): ReadonlySet<string> | null | undefined {
  if (value === undefined) return undefined;
  if (value === '*') return null;

  const addresses = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  if (addresses.length === 0 || !addresses.every((a) => ADDRESS.test(a))) {
    throw new MailConfigError(
      'MAIL_ALLOWED_RECIPIENTS must be email addresses separated by commas, ' +
        'e.g. you@example.com, or * to allow anyone.',
    );
  }

  return new Set(addresses);
}

function readPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_SMTP_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new MailConfigError(
      'MAIL_PORT must be a whole number between 1 and 65535, e.g. 1025 for ' +
        'Mailpit or 587 for a provider.',
    );
  }
  return port;
}

function isSenderAddress(value: string): boolean {
  const named = NAMED_ADDRESS.exec(value);
  return ADDRESS.test(named ? named[1].trim() : value);
}

/** Whether this address may receive real mail under the allow-list. */
export function isAllowedRecipient(
  allowedRecipients: ReadonlySet<string> | null,
  to: string,
): boolean {
  return (
    allowedRecipients === null || allowedRecipients.has(to.trim().toLowerCase())
  );
}
