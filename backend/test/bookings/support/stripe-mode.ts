/**
 * Side-effect module: imported first by confirm-stripe-mode.e2e-spec.ts, for
 * the same reason as test/auth/support/proxy-secret.ts: ConfigModule reads
 * process.env the moment AppModule is imported. Jest gives each test file its
 * own process.env, so no other file sees this.
 */
process.env.PAYMENT_MODE = 'stripe';
