import { assertTestDatabaseUrl } from './test-db-guard';

// Jest runs this before each test file, ahead of the file's own imports. It is
// the earliest point at which DATABASE_URL can be checked: importing AppModule
// lets ConfigModule back-fill the variable from ../.env (the dev database),
// after which a missing .env.test would no longer look like a missing value.
assertTestDatabaseUrl(process.env.DATABASE_URL);
