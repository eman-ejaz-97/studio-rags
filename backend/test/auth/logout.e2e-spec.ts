import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from '../../src/auth/auth.cookies';
import { AUTH, refresh, register, sha256 } from '../utils/auth';
import { expectCleared } from '../utils/cookies';
import { useTestApp } from '../utils/test-app';

describe('POST /api/v1/auth/logout', () => {
  const ctx = useTestApp();

  it('revokes the session and clears both cookies', async () => {
    const t = ctx();
    const { refreshToken } = await register(t);

    const res = await t
      .http()
      .post(`${AUTH}/logout`)
      .set('Cookie', `${REFRESH_COOKIE}=${refreshToken}`)
      .expect(204);

    expect(res.text).toBe('');
    expectCleared(res, ACCESS_COOKIE, '/');
    expectCleared(res, REFRESH_COOKIE, REFRESH_COOKIE_PATH);
    const row = await t.prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: sha256(refreshToken) },
    });
    expect(row.revokedAt).toBeInstanceOf(Date);

    await refresh(t, refreshToken).expect(401);
  });

  it('succeeds with no cookie, so a stale tab can always sign out', async () => {
    const res = await ctx().http().post(`${AUTH}/logout`).expect(204);

    expectCleared(res, ACCESS_COOKIE, '/');
    expectCleared(res, REFRESH_COOKIE, REFRESH_COOKIE_PATH);
  });
});
