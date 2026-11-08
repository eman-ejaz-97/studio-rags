/**
 * Side-effect module: imported first by proxy-secret.e2e-spec.ts, for the same
 * reason as trust-one-proxy.ts: ConfigModule reads process.env the moment
 * AppModule is imported. Jest gives each test file its own process.env.
 */
export const TEST_PROXY_SECRET = 'e2e-test-only-proxy-secret-0123456789abcdef';

process.env.API_PROXY_SECRET = TEST_PROXY_SECRET;
