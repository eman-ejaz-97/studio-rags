// Deliberately no `import 'reflect-metadata'` here. env.validation must load
// it itself, so that a script can import it without booting Nest; were that
// import removed, this file would fail to load.
import {
  EnvironmentVariables,
  NodeEnv,
  PaymentMode,
  SiteEnv,
  bareOriginProblem,
  validateEnv,
} from './env.validation';

/** The smallest environment that should boot: everything else has a default. */
const REQUIRED = {
  DATABASE_URL: 'postgresql://studio:studio@localhost:5433/studio_rags_test',
  JWT_ACCESS_SECRET: 'unit-test-only-access-secret-0123456789',
  JWT_REFRESH_SECRET: 'unit-test-only-refresh-secret-0123456789',
};

function envWith(overrides: Record<string, unknown>) {
  return { ...REQUIRED, ...overrides };
}

function without(key: keyof typeof REQUIRED) {
  const env: Record<string, unknown> = { ...REQUIRED };
  delete env[key];
  return env;
}

describe('validateEnv', () => {
  it('accepts the required variables and returns a typed config', () => {
    const config = validateEnv(REQUIRED);

    expect(config).toBeInstanceOf(EnvironmentVariables);
    expect(config.DATABASE_URL).toBe(REQUIRED.DATABASE_URL);
  });

  it('applies the documented defaults for everything optional', () => {
    const config = validateEnv(REQUIRED);

    expect(config.NODE_ENV).toBe(NodeEnv.Development);
    expect(config.PORT).toBe(3001);
    expect(config.JWT_ACCESS_TTL).toBe('15m');
    expect(config.JWT_REFRESH_TTL).toBe('30d');
    expect(config.CORS_ORIGIN).toBe('http://localhost:3000');
    expect(config.APP_URL).toBe('http://localhost:3000');
    expect(config.MAIL_FROM).toBeUndefined();
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.TRUST_PROXY).toBe(0);
    expect(config.SITE_ENV).toBeUndefined();
    expect(config.PAYMENT_MODE).toBe(PaymentMode.None);
  });

  it('ignores unrelated variables, since it is handed the whole of process.env', () => {
    expect(() =>
      validateEnv(envWith({ PATH: '/usr/bin', HOME: '/home/app', CI: 'true' })),
    ).not.toThrow();
  });

  describe('DATABASE_URL', () => {
    it('is required', () => {
      expect(() => validateEnv(without('DATABASE_URL'))).toThrow(
        /DATABASE_URL: .*should not be empty/,
      );
    });

    it('may not be empty', () => {
      expect(() => validateEnv(envWith({ DATABASE_URL: '' }))).toThrow(
        'DATABASE_URL should not be empty',
      );
    });
  });

  describe.each(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const)(
    '%s',
    (key) => {
      it('is required', () => {
        expect(() => validateEnv(without(key))).toThrow(`${key}: `);
      });

      it('fails under 32 characters with the stated message', () => {
        expect(() => validateEnv(envWith({ [key]: 'x'.repeat(31) }))).toThrow(
          `${key} must be at least 32 characters`,
        );
      });

      it('passes at exactly 32 characters', () => {
        expect(validateEnv(envWith({ [key]: 'x'.repeat(32) }))[key]).toBe(
          'x'.repeat(32),
        );
      });
    },
  );

  describe('JWT secrets', () => {
    it('refuses the same value for both, without echoing it', () => {
      const shared = 'one-value-pasted-into-both-boxes-0123456789';
      const attempt = () =>
        validateEnv(
          envWith({ JWT_ACCESS_SECRET: shared, JWT_REFRESH_SECRET: shared }),
        );

      expect(attempt).toThrow(
        '  - JWT_REFRESH_SECRET: JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
      );
      expect(attempt).not.toThrow(shared);
    });

    it('accepts two different values', () => {
      expect(() => validateEnv(REQUIRED)).not.toThrow();
    });

    it('reports the clash alongside every other problem', () => {
      const attempt = () =>
        validateEnv({
          DATABASE_URL: '',
          JWT_ACCESS_SECRET: 'x'.repeat(40),
          JWT_REFRESH_SECRET: 'x'.repeat(40),
        });

      expect(attempt).toThrow('  - DATABASE_URL: ');
      expect(attempt).toThrow('must differ from JWT_ACCESS_SECRET');
    });
  });

  describe.each(['JWT_ACCESS_TTL', 'JWT_REFRESH_TTL'])('%s', (key) => {
    it.each(['45s', '15m', '2h', '30d', ' 15 m '])(
      'accepts %p, a shape TokenService can parse',
      (ttl) => {
        expect(() => validateEnv(envWith({ [key]: ttl }))).not.toThrow();
      },
    );

    // Each of these would otherwise boot, then fail on the first login.
    it.each(['15', '15min', '1.5h', '-5m', '15M', '2w', '', 'm15'])(
      'refuses %p at boot with a message showing the expected shape',
      (ttl) => {
        expect(() => validateEnv(envWith({ [key]: ttl }))).toThrow(
          `${key} must be a whole number followed by s, m, h or d (seconds, minutes, hours, days), e.g. 15m or 30d`,
        );
      },
    );
  });

  describe('HOST', () => {
    it('defaults to every interface, which a container needs', () => {
      expect(validateEnv(REQUIRED).HOST).toBe('0.0.0.0');
    });

    it('can be narrowed, e.g. to loopback for local work', () => {
      expect(validateEnv(envWith({ HOST: '127.0.0.1' })).HOST).toBe(
        '127.0.0.1',
      );
    });

    it('may not be empty', () => {
      expect(() => validateEnv(envWith({ HOST: '' }))).toThrow(
        'HOST should not be empty',
      );
    });
  });

  describe('TRUST_PROXY', () => {
    it('is off by default', () => {
      expect(validateEnv(REQUIRED).TRUST_PROXY).toBe(0);
    });

    it.each([
      ['0', 0],
      ['1', 1],
      ['2', 2],
    ])('reads %p as the hop count %d', (raw, hops) => {
      expect(validateEnv(envWith({ TRUST_PROXY: raw })).TRUST_PROXY).toBe(hops);
    });

    // Express would read "true" as trust-everything, which lets any client
    // choose its own address. Only a hop count is accepted.
    it.each(['true', 'yes', '-1', '1.5', 'loopback'])('refuses %p', (raw) => {
      expect(() => validateEnv(envWith({ TRUST_PROXY: raw }))).toThrow(
        'TRUST_PROXY must be a whole number of proxy hops',
      );
    });
  });

  describe('API_PROXY_SECRET', () => {
    const SECRET = 'unit-test-only-proxy-secret-0123456789';

    it('is unset by default, so no forwarded address is believed', () => {
      expect(validateEnv(REQUIRED).API_PROXY_SECRET).toBeUndefined();
    });

    it('treats an empty value as unset', () => {
      expect(
        validateEnv(envWith({ API_PROXY_SECRET: '' })).API_PROXY_SECRET,
      ).toBeUndefined();
    });

    it('accepts a value of 32 characters or more', () => {
      expect(
        validateEnv(envWith({ API_PROXY_SECRET: SECRET })).API_PROXY_SECRET,
      ).toBe(SECRET);
    });

    it('refuses a short value, and says how to make a good one', () => {
      expect(() =>
        validateEnv(envWith({ API_PROXY_SECRET: 'too-short' })),
      ).toThrow(
        'API_PROXY_SECRET must be at least 32 characters when set; generate one with `openssl rand -hex 32`',
      );
    });
  });

  describe('SITE_ENV', () => {
    it.each(Object.values(SiteEnv))('accepts %s', (site) => {
      expect(
        validateEnv(envWith({ SITE_ENV: site, PAYMENT_MODE: 'stripe' }))
          .SITE_ENV,
      ).toBe(site);
    });

    it('treats an empty value as unset', () => {
      expect(validateEnv(envWith({ SITE_ENV: '' })).SITE_ENV).toBeUndefined();
    });

    // A typo here would otherwise read as "not production" and let
    // PAYMENT_MODE=none through on a live site.
    it.each(['prod', 'Production', 'live', 'development'])(
      'refuses %p',
      (site) => {
        expect(() => validateEnv(envWith({ SITE_ENV: site }))).toThrow(
          'SITE_ENV must be staging or production when set',
        );
      },
    );
  });

  describe('PAYMENT_MODE', () => {
    const NONE_ON_PRODUCTION =
      'PAYMENT_MODE=none confirms bookings without payment and is refused when SITE_ENV=production';
    const NONE_NEEDS_STAGING =
      'with NODE_ENV=production it needs SITE_ENV=staging';

    it.each(Object.values(PaymentMode))('accepts %s', (mode) => {
      expect(
        validateEnv(envWith({ PAYMENT_MODE: mode, SITE_ENV: 'staging' }))
          .PAYMENT_MODE,
      ).toBe(mode);
    });

    it.each(['', 'None', 'free', 'paypal'])('refuses %p', (mode) => {
      expect(() => validateEnv(envWith({ PAYMENT_MODE: mode }))).toThrow(
        'PAYMENT_MODE must be none (confirm bookings without payment: local, tests and staging) or stripe',
      );
    });

    it.each([NodeEnv.Development, NodeEnv.Test])(
      'allows none under NODE_ENV=%s with no SITE_ENV, for local work and tests',
      (nodeEnv) => {
        expect(
          validateEnv(envWith({ NODE_ENV: nodeEnv, PAYMENT_MODE: 'none' }))
            .PAYMENT_MODE,
        ).toBe(PaymentMode.None);
      },
    );

    it('allows none on the staging site, which runs with NODE_ENV=production', () => {
      const config = validateEnv(
        envWith({
          NODE_ENV: 'production',
          SITE_ENV: 'staging',
          PAYMENT_MODE: 'none',
        }),
      );

      expect(config.PAYMENT_MODE).toBe(PaymentMode.None);
      expect(config.SITE_ENV).toBe(SiteEnv.Staging);
    });

    it.each([NodeEnv.Development, NodeEnv.Test, NodeEnv.Production])(
      'refuses none on a site that says it is production, under NODE_ENV=%s',
      (nodeEnv) => {
        expect(() =>
          validateEnv(
            envWith({
              NODE_ENV: nodeEnv,
              SITE_ENV: 'production',
              PAYMENT_MODE: 'none',
            }),
          ),
        ).toThrow(`  - PAYMENT_MODE: ${NONE_ON_PRODUCTION}`);
      },
    );

    it('refuses the default too: a live site cannot start without payment by leaving it out', () => {
      expect(() =>
        validateEnv(
          envWith({ NODE_ENV: 'production', SITE_ENV: 'production' }),
        ),
      ).toThrow(NONE_ON_PRODUCTION);
    });

    it.each([
      ['left out', {}],
      ['empty', { SITE_ENV: '' }],
    ])(
      'refuses none under NODE_ENV=production when SITE_ENV is %s',
      (_, site) => {
        expect(() =>
          validateEnv(envWith({ NODE_ENV: 'production', ...site })),
        ).toThrow(
          `  - PAYMENT_MODE: PAYMENT_MODE=none confirms bookings without payment, so ${NONE_NEEDS_STAGING}`,
        );
      },
    );

    it.each([SiteEnv.Production, SiteEnv.Staging, undefined])(
      'allows stripe anywhere (SITE_ENV=%s, NODE_ENV=production)',
      (site) => {
        expect(
          validateEnv(
            envWith({
              NODE_ENV: 'production',
              SITE_ENV: site,
              PAYMENT_MODE: 'stripe',
            }),
          ).PAYMENT_MODE,
        ).toBe(PaymentMode.Stripe);
      },
    );
  });

  describe('PORT', () => {
    it('coerces the string every env var arrives as into a number', () => {
      const config = validateEnv(envWith({ PORT: '4000' }));

      expect(config.PORT).toBe(4000);
      expect(typeof config.PORT).toBe('number');
    });

    it.each(['abc', '30.5'])('rejects %p as not an integer', (port) => {
      expect(() => validateEnv(envWith({ PORT: port }))).toThrow(
        'PORT must be an integer number',
      );
    });
  });

  describe('NODE_ENV', () => {
    // stripe, so that production is judged on NODE_ENV alone; PAYMENT_MODE
    // below covers what none needs there.
    it.each(Object.values(NodeEnv))('accepts %s', (nodeEnv) => {
      expect(
        validateEnv(envWith({ NODE_ENV: nodeEnv, PAYMENT_MODE: 'stripe' }))
          .NODE_ENV,
      ).toBe(nodeEnv);
    });

    it.each(['staging', 'prod', 'Production'])('rejects %p', (nodeEnv) => {
      expect(() => validateEnv(envWith({ NODE_ENV: nodeEnv }))).toThrow(
        'NODE_ENV must be one of the following values: development, test, production',
      );
    });
  });

  describe('CORS_ORIGIN', () => {
    it.each([
      'https://studio-rags.vercel.app',
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://[::1]:3000',
    ])('accepts the bare origin %p', (origin) => {
      expect(validateEnv(envWith({ CORS_ORIGIN: origin })).CORS_ORIGIN).toBe(
        origin,
      );
    });

    // The browser's Origin header never carries any of these, and the cors
    // package compares strings exactly, so each would fail every request.
    it.each([
      ['a trailing slash', 'https://studio-rags.vercel.app/'],
      ['a path', 'https://studio-rags.vercel.app/api/v1'],
      ['a query', 'https://studio-rags.vercel.app?preview=1'],
      ['a fragment', 'https://studio-rags.vercel.app#top'],
      ['the default port', 'https://studio-rags.vercel.app:443'],
      ['upper case', 'https://Studio-Rags.vercel.app'],
      ['credentials', 'https://user:pass@studio-rags.vercel.app'],
    ])('refuses %s and names the origin to use instead', (_label, value) => {
      expect(() => validateEnv(envWith({ CORS_ORIGIN: value }))).toThrow(
        'CORS_ORIGIN must be a bare origin (lower-case scheme and host, no path, query, trailing slash or default port): use "https://studio-rags.vercel.app"',
      );
    });

    it.each([
      ['no scheme', 'studio-rags.vercel.app'],
      ['host and port only', 'localhost:3000'],
      ['another scheme', 'ftp://studio-rags.vercel.app'],
      ['not a URL', 'not a url'],
      ['a wildcard', '*'],
    ])('refuses %s: a scheme is required', (_label, value) => {
      expect(() => validateEnv(envWith({ CORS_ORIGIN: value }))).toThrow(
        'CORS_ORIGIN must start with http:// or https://',
      );
    });

    it.each([
      'https://a.example.com,https://b.example.com',
      'https://a.example.com https://b.example.com',
    ])('refuses a list of origins (%p)', (value) => {
      expect(() => validateEnv(envWith({ CORS_ORIGIN: value }))).toThrow(
        'CORS_ORIGIN must be exactly one origin',
      );
    });

    it('refuses a scheme with no host', () => {
      expect(() => validateEnv(envWith({ CORS_ORIGIN: 'https://' }))).toThrow(
        'CORS_ORIGIN must be a valid origin',
      );
    });

    it('describes a non-string value without throwing inside the validator', () => {
      expect(bareOriginProblem(42)).toBe('must be a string');
      expect(bareOriginProblem(undefined)).toBe('must be a string');
    });
  });

  describe('APP_URL', () => {
    const key = 'APP_URL';
    it('accepts an https URL', () => {
      const value = 'https://studio-rags.example.com.au';
      expect(validateEnv(envWith({ [key]: value }))).toMatchObject({
        [key]: value,
      });
    });

    it.each(['not a url', 'https://a.example.com,https://b.example.com'])(
      'rejects %p',
      (value) => {
        expect(() => validateEnv(envWith({ [key]: value }))).toThrow(
          `${key} must be a URL address`,
        );
      },
    );
  });

  it('reports every problem in one go, so a bad deploy is fixed in one pass', () => {
    const attempt = () =>
      validateEnv({ PORT: 'abc', JWT_ACCESS_SECRET: 'short' });

    expect(attempt).toThrow(/^Invalid environment configuration:\n/);
    for (const key of [
      'PORT',
      'DATABASE_URL',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
    ]) {
      expect(attempt).toThrow(`  - ${key}: `);
    }
  });
});
