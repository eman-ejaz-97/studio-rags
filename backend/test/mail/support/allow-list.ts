/**
 * Side-effect module: imported first by staging-allow-list.e2e-spec.ts, for
 * the same reason as test/auth/support/proxy-secret.ts: ConfigModule reads
 * process.env the moment AppModule is imported. Jest gives each test file its
 * own process.env, so no other file sees this.
 */
export const ALLOWED_RECIPIENT = 'developer@example.com';

process.env.MAIL_ALLOWED_RECIPIENTS = ALLOWED_RECIPIENT;
