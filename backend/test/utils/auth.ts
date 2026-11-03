import { createHash } from 'node:crypto';
import type { Response } from 'supertest';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../src/auth/auth.cookies';
import { getSetCookie } from './cookies';
import type { TestApp } from './test-app';

export const AUTH = '/api/v1/auth';
export const PASSWORD = 'correct-horse-battery';

export interface PublicUserBody {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: 'CUSTOMER' | 'ADMIN';
  marketingConsent: boolean;
  createdAt: string;
}

export interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error?: string;
}

export interface Session {
  res: Response;
  user: PublicUserBody;
  accessToken: string;
  refreshToken: string;
}

export function registerBody(overrides: Record<string, unknown> = {}) {
  return {
    email: 'ada@example.com',
    password: PASSWORD,
    firstName: 'Ada',
    lastName: 'Lovelace',
    ...overrides,
  };
}

/** Same hash the server stores, so a raw token can be matched to its row. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function toSession(res: Response): Session {
  return {
    res,
    user: (res.body as { user: PublicUserBody }).user,
    accessToken: getSetCookie(res, ACCESS_COOKIE).value,
    refreshToken: getSetCookie(res, REFRESH_COOKIE).value,
  };
}

export async function register(
  t: TestApp,
  overrides: Record<string, unknown> = {},
): Promise<Session> {
  const res = await t
    .http()
    .post(`${AUTH}/register`)
    .send(registerBody(overrides))
    .expect(201);
  return toSession(res);
}

export async function login(
  t: TestApp,
  email = 'ada@example.com',
  password = PASSWORD,
): Promise<Session> {
  const res = await t
    .http()
    .post(`${AUTH}/login`)
    .send({ email, password })
    .expect(200);
  return toSession(res);
}

/** POST /auth/refresh presenting the given refresh token as the browser would. */
export function refresh(t: TestApp, refreshToken: string) {
  return t
    .http()
    .post(`${AUTH}/refresh`)
    .set('Cookie', `${REFRESH_COOKIE}=${refreshToken}`);
}

/** GET /auth/me presenting the given access token in the cookie. */
export function me(t: TestApp, accessToken: string) {
  return t
    .http()
    .get(`${AUTH}/me`)
    .set('Cookie', `${ACCESS_COOKIE}=${accessToken}`);
}

/**
 * Pins the next reset token TokenService generates, so the test knows the raw
 * value that would otherwise only exist in the email.
 */
export function pinNextResetToken(t: TestApp, token: string) {
  return jest.spyOn(t.tokens, 'randomToken').mockReturnValueOnce(token);
}

export async function requestReset(
  t: TestApp,
  email: string,
  token: string,
): Promise<void> {
  pinNextResetToken(t, token);
  await t.http().post(`${AUTH}/forgot-password`).send({ email }).expect(202);
}
