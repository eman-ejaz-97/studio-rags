/**
 * Side-effect module: imported first by trusted-proxy.e2e-spec.ts.
 *
 * ConfigModule.forRoot reads and validates process.env the moment AppModule is
 * imported, so a test that needs a different setting must make it before any
 * import reaches AppModule. Jest gives each test file its own copy of
 * process.env, so the change stays inside that one file.
 */
process.env.TRUST_PROXY = '1';
