import * as argon2 from 'argon2';
import { Role } from '@prisma/client';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from '../../src/auth/auth.cookies';
import {
  AUTH,
  ErrorBody,
  PASSWORD,
  PublicUserBody,
  register,
  registerBody,
  sha256,
} from '../utils/auth';
import { getSetCookie } from '../utils/cookies';
import { useTestApp } from '../utils/test-app';

describe('POST /api/v1/auth/register', () => {
  const ctx = useTestApp();

  it('creates a customer and starts a session in httpOnly, Lax cookies', async () => {
    const t = ctx();
    const res = await t
      .http()
      .post(`${AUTH}/register`)
      .send(registerBody())
      .expect(201);

    const access = getSetCookie(res, ACCESS_COOKIE);
    expect(access).toMatchObject({
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      // Secure only in production; the test env is plain http.
      secure: false,
      maxAge: 15 * 60,
    });
    expect(access.value).not.toBe('');

    const refresh = getSetCookie(res, REFRESH_COOKIE);
    expect(refresh).toMatchObject({
      path: REFRESH_COOKIE_PATH,
      httpOnly: true,
      sameSite: 'Lax',
      secure: false,
      maxAge: 30 * 24 * 60 * 60,
    });
    expect(refresh.value).not.toBe('');

    const { user } = res.body as { user: PublicUserBody };
    const { id, createdAt, ...rest } = user;
    // toEqual on the rest pins the exact field list, so a leaked
    // passwordHash or any other new field fails here.
    expect(rest).toEqual({
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: null,
      role: 'CUSTOMER',
      marketingConsent: false,
    });
    expect(typeof id).toBe('string');
    expect(Number.isNaN(Date.parse(createdAt))).toBe(false);
    expect(res.text).not.toMatch(/passwordHash|argon2/i);

    const stored = await t.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: { refreshTokens: true },
    });
    expect(stored.role).toBe(Role.CUSTOMER);
    // The session row holds a hash of the refresh token, never the token.
    expect(stored.refreshTokens).toHaveLength(1);
    expect(stored.refreshTokens[0].tokenHash).toBe(sha256(refresh.value));
  });

  it('stores the email trimmed and lower-cased', async () => {
    const t = ctx();
    const { user } = await register(t, {
      email: '  Ada.Lovelace@Example.COM  ',
    });

    expect(user.email).toBe('ada.lovelace@example.com');
    const stored = await t.prisma.user.findMany({ select: { email: true } });
    expect(stored).toEqual([{ email: 'ada.lovelace@example.com' }]);
  });

  it('rejects the same email in a different case with 409', async () => {
    const t = ctx();
    await register(t, { email: 'ada@example.com' });

    const res = await t
      .http()
      .post(`${AUTH}/register`)
      .send(registerBody({ email: 'ADA@Example.com' }))
      .expect(409);

    expect((res.body as ErrorBody).message).toBe(
      'An account with that email already exists',
    );
    await expect(t.prisma.user.count()).resolves.toBe(1);
  });

  it('rejects a short password with 400 and says why', async () => {
    const t = ctx();
    const res = await t
      .http()
      .post(`${AUTH}/register`)
      .send(registerBody({ password: 'short' }))
      .expect(400);

    expect((res.body as ErrorBody).message).toContain(
      'Password must be at least 10 characters',
    );
    await expect(t.prisma.user.count()).resolves.toBe(0);
  });

  it('refuses a role in the body rather than granting it', async () => {
    const t = ctx();
    const res = await t
      .http()
      .post(`${AUTH}/register`)
      .send(registerBody({ role: 'ADMIN' }))
      .expect(400);

    // forbidNonWhitelisted turns mass assignment into a hard error, not a
    // silently dropped field.
    expect((res.body as ErrorBody).message).toContain(
      'property role should not exist',
    );
    expect(res.get('Set-Cookie')).toBeUndefined();
    await expect(
      t.prisma.user.count({ where: { role: Role.ADMIN } }),
    ).resolves.toBe(0);
    await expect(t.prisma.user.count()).resolves.toBe(0);
  });

  it('records marketing consent only on an explicit opt-in', async () => {
    const t = ctx();
    const before = Date.now();
    const optedIn = await register(t, {
      email: 'yes@example.com',
      marketingConsent: true,
    });
    const silent = await register(t, { email: 'silent@example.com' });

    expect(optedIn.user.marketingConsent).toBe(true);
    expect(silent.user.marketingConsent).toBe(false);

    const yes = await t.prisma.user.findUniqueOrThrow({
      where: { email: 'yes@example.com' },
    });
    const no = await t.prisma.user.findUniqueOrThrow({
      where: { email: 'silent@example.com' },
    });
    expect(yes.marketingConsentAt).toBeInstanceOf(Date);
    expect(yes.marketingConsentAt!.getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
    expect(no.marketingConsentAt).toBeNull();
  });

  it('stores an argon2id hash, never the password', async () => {
    const t = ctx();
    await register(t);

    const { passwordHash } = await t.prisma.user.findUniqueOrThrow({
      where: { email: 'ada@example.com' },
    });
    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).not.toContain(PASSWORD);
    await expect(argon2.verify(passwordHash, PASSWORD)).resolves.toBe(true);
  });
});
