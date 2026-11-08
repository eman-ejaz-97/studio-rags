import {
  DEFAULT_MAIL_FROM,
  DEFAULT_SMTP_HOST,
  DEFAULT_SMTP_PORT,
  MailConfigError,
  isAllowedRecipient,
  readMailConfig,
} from './mail.config';

/** What staging sets (render.yaml), with a made-up key. */
const RESEND = {
  NODE_ENV: 'production',
  MAIL_TRANSPORT: 'resend',
  RESEND_API_KEY: 're_test_key_that_must_never_be_printed',
  MAIL_FROM: 'Studio Rags <onboarding@resend.dev>',
  MAIL_ALLOWED_RECIPIENTS: 'Developer@Example.com',
};

function problemWith(env: Record<string, string | undefined>): string {
  try {
    readMailConfig(env);
  } catch (err) {
    expect(err).toBeInstanceOf(MailConfigError);
    return (err as Error).message;
  }
  throw new Error('readMailConfig accepted a configuration it should refuse');
}

describe('readMailConfig', () => {
  describe('choosing the transport', () => {
    it('defaults to smtp on Mailpit when nothing is set outside production', () => {
      expect(readMailConfig({ NODE_ENV: 'development' })).toEqual({
        transport: 'smtp',
        host: DEFAULT_SMTP_HOST,
        port: DEFAULT_SMTP_PORT,
        auth: undefined,
        from: DEFAULT_MAIL_FROM,
        allowedRecipients: null,
      });
    });

    it('treats empty values as unset, as a copied KEY= line would be', () => {
      expect(
        readMailConfig({
          MAIL_TRANSPORT: '',
          MAIL_HOST: ' ',
          MAIL_PORT: '',
          MAIL_FROM: '',
          MAIL_ALLOWED_RECIPIENTS: '',
        }),
      ).toMatchObject({
        transport: 'smtp',
        host: DEFAULT_SMTP_HOST,
        port: DEFAULT_SMTP_PORT,
        allowedRecipients: null,
      });
    });

    it('chooses resend, and keeps the key, sender and allow-list', () => {
      const config = readMailConfig(RESEND);

      expect(config).toEqual({
        transport: 'resend',
        apiKey: RESEND.RESEND_API_KEY,
        from: RESEND.MAIL_FROM,
        allowedRecipients: new Set(['developer@example.com']),
      });
    });

    it('chooses memory for tests', () => {
      expect(
        readMailConfig({ NODE_ENV: 'test', MAIL_TRANSPORT: 'memory' }),
      ).toEqual({
        transport: 'memory',
        from: DEFAULT_MAIL_FROM,
        allowedRecipients: null,
      });
    });

    it('accepts the transport name in any case', () => {
      expect(readMailConfig({ MAIL_TRANSPORT: 'SMTP' }).transport).toBe('smtp');
    });

    it('refuses a transport it does not know', () => {
      expect(problemWith({ MAIL_TRANSPORT: 'sendgrid' })).toContain(
        'MAIL_TRANSPORT must be one of smtp, resend, memory',
      );
    });

    it('insists on a choice in production rather than guessing Mailpit', () => {
      expect(problemWith({ NODE_ENV: 'production' })).toContain(
        'MAIL_TRANSPORT must be set when NODE_ENV=production',
      );
    });

    it('refuses memory in production, where it would claim mail went out', () => {
      expect(
        problemWith({ NODE_ENV: 'production', MAIL_TRANSPORT: 'memory' }),
      ).toContain('MAIL_TRANSPORT=memory is for tests');
    });
  });

  describe('resend', () => {
    it('requires the API key', () => {
      expect(problemWith({ ...RESEND, RESEND_API_KEY: '' })).toContain(
        'RESEND_API_KEY is required when MAIL_TRANSPORT=resend',
      );
    });

    it('refuses something that is not a Resend key, without echoing it', () => {
      const message = problemWith({
        ...RESEND,
        RESEND_API_KEY: 'sk_live_pasted_from_the_wrong_dashboard',
      });

      expect(message).toContain('start with "re_"');
      expect(message).not.toContain('sk_live_pasted_from_the_wrong_dashboard');
    });

    it('requires a sender, because the default domain is not verified', () => {
      expect(problemWith({ ...RESEND, MAIL_FROM: undefined })).toContain(
        'onboarding@resend.dev',
      );
    });

    it('requires the allow-list, so a forgotten one fails at boot (ADR-040)', () => {
      expect(
        problemWith({ ...RESEND, MAIL_ALLOWED_RECIPIENTS: undefined }),
      ).toContain('MAIL_ALLOWED_RECIPIENTS is required');
    });

    it('takes * as a deliberate choice to allow anyone', () => {
      expect(
        readMailConfig({ ...RESEND, MAIL_ALLOWED_RECIPIENTS: '*' })
          .allowedRecipients,
      ).toBeNull();
    });

    it('never puts the key in any message', () => {
      for (const env of [
        { ...RESEND, MAIL_FROM: 'not an address' },
        { ...RESEND, MAIL_ALLOWED_RECIPIENTS: 'nobody' },
        { ...RESEND, MAIL_FROM: undefined },
      ]) {
        expect(problemWith(env)).not.toContain(RESEND.RESEND_API_KEY);
      }
    });
  });

  describe('smtp', () => {
    it('reads host, port and sign-in', () => {
      expect(
        readMailConfig({
          MAIL_TRANSPORT: 'smtp',
          MAIL_HOST: 'smtp.example.com',
          MAIL_PORT: '587',
          MAIL_USER: 'user',
          MAIL_PASSWORD: 'secret',
        }),
      ).toMatchObject({
        host: 'smtp.example.com',
        port: 587,
        auth: { user: 'user', pass: 'secret' },
      });
    });

    it('wants a user and password together or not at all', () => {
      expect(problemWith({ MAIL_USER: 'user' })).toContain(
        'MAIL_USER and MAIL_PASSWORD go together',
      );
      expect(problemWith({ MAIL_PASSWORD: 'secret' })).toContain(
        'MAIL_USER and MAIL_PASSWORD go together',
      );
    });

    it.each(['0', '65536', '25.5', 'mailpit'])(
      'refuses MAIL_PORT=%s',
      (port) => {
        expect(problemWith({ MAIL_PORT: port })).toContain(
          'MAIL_PORT must be a whole number',
        );
      },
    );

    it('honours an allow-list when one is set, so it can be tried locally', () => {
      expect(
        readMailConfig({ MAIL_ALLOWED_RECIPIENTS: 'a@example.com' })
          .allowedRecipients,
      ).toEqual(new Set(['a@example.com']));
    });
  });

  describe('MAIL_FROM', () => {
    it.each([
      'hello@studiorags.com.au',
      'Studio Rags <hello@studiorags.com.au>',
      '"Studio Rags" <onboarding@resend.dev>',
    ])('accepts %s', (from) => {
      expect(readMailConfig({ MAIL_FROM: from }).from).toBe(from);
    });

    it.each(['Studio Rags', 'Studio Rags <>', 'a@b', '<a@example.com'])(
      'refuses %s',
      (from) => {
        expect(problemWith({ MAIL_FROM: from })).toContain(
          'MAIL_FROM must be an email address',
        );
      },
    );
  });

  describe('MAIL_ALLOWED_RECIPIENTS', () => {
    it('splits on commas, trims and lower-cases', () => {
      expect(
        readMailConfig({
          MAIL_ALLOWED_RECIPIENTS: ' One@Example.com ,two@example.com,, ',
        }).allowedRecipients,
      ).toEqual(new Set(['one@example.com', 'two@example.com']));
    });

    it.each([
      'nobody',
      'a@example.com; b@example.com',
      ',',
      '*, a@example.com',
    ])('refuses %p', (value) => {
      expect(problemWith({ MAIL_ALLOWED_RECIPIENTS: value })).toContain(
        'MAIL_ALLOWED_RECIPIENTS must be email addresses separated by commas',
      );
    });
  });
});

describe('isAllowedRecipient', () => {
  const allowed = new Set(['developer@example.com']);

  it('lets anyone through when there is no allow-list', () => {
    expect(isAllowedRecipient(null, 'anyone@example.com')).toBe(true);
  });

  it('matches regardless of case and stray spaces', () => {
    expect(isAllowedRecipient(allowed, ' Developer@Example.COM ')).toBe(true);
  });

  it('turns away everyone else', () => {
    expect(isAllowedRecipient(allowed, 'customer@example.com')).toBe(false);
  });
});
