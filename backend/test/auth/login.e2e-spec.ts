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
} from '../utils/auth';
import { getSetCookie } from '../utils/cookies';
import { useTestApp } from '../utils/test-app';

describe('POST /api/v1/auth/login', () => {
  const ctx = useTestApp();

  it('signs in with the right password and sets both cookies', async () => {
    const t = ctx();
    const { user } = await register(t);

    const res = await t
      .http()
      .post(`${AUTH}/login`)
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(200);

    expect((res.body as { user: PublicUserBody }).user.id).toBe(user.id);
    expect(getSetCookie(res, ACCESS_COOKIE)).toMatchObject({
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure: false,
    });
    expect(getSetCookie(res, REFRESH_COOKIE)).toMatchObject({
      path: REFRESH_COOKIE_PATH,
      httpOnly: true,
      sameSite: 'Lax',
      secure: false,
    });
    // Registration's session plus this one.
    await expect(t.prisma.refreshToken.count()).resolves.toBe(2);
  });

  it('rejects a wrong password with 401 and no cookies', async () => {
    const t = ctx();
    await register(t);

    const res = await t
      .http()
      .post(`${AUTH}/login`)
      .send({ email: 'ada@example.com', password: 'not-the-password' })
      .expect(401);

    expect((res.body as ErrorBody).message).toBe(
      'Email or password is incorrect',
    );
    expect(res.get('Set-Cookie')).toBeUndefined();
  });

  it('answers an unknown email with the identical 401, so accounts cannot be enumerated', async () => {
    const t = ctx();
    await register(t);

    const wrongPassword = await t
      .http()
      .post(`${AUTH}/login`)
      .send({ email: 'ada@example.com', password: 'not-the-password' })
      .expect(401);
    const unknownEmail = await t
      .http()
      .post(`${AUTH}/login`)
      .send({ email: 'nobody@example.com', password: 'not-the-password' })
      .expect(401);

    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });

  it('treats the email case-insensitively', async () => {
    const t = ctx();
    const { user } = await register(t);

    const res = await t
      .http()
      .post(`${AUTH}/login`)
      .send({ email: '  ADA@Example.COM ', password: PASSWORD })
      .expect(200);

    expect((res.body as { user: PublicUserBody }).user.id).toBe(user.id);
  });
});
