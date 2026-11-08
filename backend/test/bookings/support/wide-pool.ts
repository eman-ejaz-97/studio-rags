/**
 * Side-effect module: imported before anything reaches AppModule by
 * concurrency.e2e-spec.ts, for the same reason as test/auth/support/
 * proxy-secret.ts. Jest gives each test file its own process.env.
 *
 * Prisma's pool defaults to two connections per CPU plus one, which is five
 * on a two-core CI runner. The race is real at five, but with 25 that many
 * booking transactions are open at once, each on its own connection, queued
 * on the same session lock: the peak a popular class would see.
 */
const url = new URL(process.env.DATABASE_URL ?? '');
url.searchParams.set('connection_limit', '25');
process.env.DATABASE_URL = url.toString();
