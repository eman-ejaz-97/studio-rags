import { JwtService } from '@nestjs/jwt';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from '../../src/auth/auth.cookies';
import { REFRESH_REUSE_GRACE_MS } from '../../src/auth/auth.service';
import {
  AUTH,
  ErrorBody,
  login,
  me,
  refresh,
  register,
  requestReset,
  sha256,
} from '../utils/auth';
import { expectCleared, getSetCookie, parseSetCookies } from '../utils/cookies';
import { useTestApp } from '../utils/test-app';

describe('POST /api/v1/auth/refresh', () => {
  const ctx = useTestApp();

  const rowFor = (token: string) =>
    ctx().prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: sha256(token) },
    });

  it('rotates: new cookies, and the presented token is spent', async () => {
    const t = ctx();
    const first = await register(t);

    const res = await refresh(t, first.refreshToken).expect(200);

    expect(res.body).toEqual({ ok: true });
    const access = getSetCookie(res, ACCESS_COOKIE);
    const next = getSetCookie(res, REFRESH_COOKIE);
    expect(next).toMatchObject({ path: REFRESH_COOKIE_PATH, httpOnly: true });
    expect(next.value).not.toBe(first.refreshToken);

    const spent = await rowFor(first.refreshToken);
    expect(spent.revokedAt).toBeInstanceOf(Date);
    const successor = await rowFor(next.value);
    expect(successor.revokedAt).toBeNull();
    // Linked back to the token it replaced, for reuse detection.
    expect(successor.rotatedFromId).toBe(spent.id);
    await me(t, access.value).expect(200);
  });

  /**
   * Moves a revoked token's revokedAt back, as if it was revoked `ms` ago.
   * The reason it was revoked stays as the server recorded it.
   */
  const revokedAgo = (token: string, ms: number) =>
    ctx().prisma.refreshToken.update({
      where: { tokenHash: sha256(token) },
      data: { revokedAt: new Date(Date.now() - ms) },
    });

  it('treats a token spent longer ago than the grace window, whose successor was used, as theft and ends every session', async () => {
    const t = ctx();
    const first = await register(t);
    const otherDevice = await login(t);
    // One party refreshes with the token, and later with its successor...
    const second = getSetCookie(
      await refresh(t, first.refreshToken).expect(200),
      REFRESH_COOKIE,
    ).value;
    const third = getSetCookie(
      await refresh(t, second).expect(200),
      REFRESH_COOKIE,
    ).value;
    await revokedAgo(first.refreshToken, REFRESH_REUSE_GRACE_MS + 1000);

    // ...while another still holds the first: two parties held the session.
    const res = await refresh(t, first.refreshToken).expect(401);

    expectCleared(res, ACCESS_COOKIE, '/');
    expectCleared(res, REFRESH_COOKIE, REFRESH_COOKIE_PATH);
    await expect(
      t.prisma.refreshToken.count({ where: { revokedAt: null } }),
    ).resolves.toBe(0);
    // Whoever holds the current token, legitimate or not, is signed out too.
    await refresh(t, third).expect(401);
    await refresh(t, otherDevice.refreshToken).expect(401);
  });

  it('a token spent longer ago than the grace window, whose successor was used to sign out, is theft too', async () => {
    // The laptop received the successor and signed out with it, so the jar
    // that held the first token no longer does. Whoever sends it now copied
    // it from somewhere.
    const t = ctx();
    const first = await register(t);
    const otherDevice = await login(t);
    const second = getSetCookie(
      await refresh(t, first.refreshToken).expect(200),
      REFRESH_COOKIE,
    ).value;
    await t
      .http()
      .post(`${AUTH}/logout`)
      .set('Cookie', `${REFRESH_COOKIE}=${second}`)
      .expect(204);
    await revokedAgo(first.refreshToken, REFRESH_REUSE_GRACE_MS + 1000);

    await refresh(t, first.refreshToken).expect(401);

    await refresh(t, otherDevice.refreshToken).expect(401);
  });

  it('a refresh whose answer never arrived: that browser’s session ends at its next refresh, and the other devices keep theirs', async () => {
    // The server spends the laptop's token and writes the successor, but the
    // response is lost on the way back: a cold start that timed out, a
    // dropped connection. The successor never reaches anyone.
    const t = ctx();
    const laptop = await register(t);
    const phone = await login(t);
    const neverArrived = getSetCookie(
      await refresh(t, laptop.refreshToken).expect(200),
      REFRESH_COOKIE,
    ).value;
    // The browser retries at once. That is the race-lost 401, which leaves
    // the cookie jar alone, so the jar still holds the spent token...
    const retry = await refresh(t, laptop.refreshToken).expect(401);
    expect([...parseSetCookies(retry).keys()]).toEqual([]);
    // ...and sends it again at the next refresh, after the grace window.
    await revokedAgo(laptop.refreshToken, REFRESH_REUSE_GRACE_MS + 1000);

    const res = await refresh(t, laptop.refreshToken).expect(401);

    // This browser's session is over, and its cookies go.
    expectCleared(res, ACCESS_COOKIE, '/');
    expectCleared(res, REFRESH_COOKIE, REFRESH_COOKIE_PATH);
    // The successor is revoked too. Had a thief sent the old token instead,
    // the owner would hold this one, so neither of them keeps the session.
    expect(await rowFor(neverArrived)).toMatchObject({
      revokedAt: expect.any(Date) as Date,
      revokedReason: 'REUSE_DETECTED',
    });
    await refresh(t, neverArrived).expect(401);
    // Nothing else was exposed by this cookie: the phone stays signed in.
    await refresh(t, phone.refreshToken).expect(200);
  });

  it('a token already answered as theft, replayed after the owner signs in again, ends nothing more', async () => {
    const t = ctx();
    const stolen = await register(t);
    const second = getSetCookie(
      await refresh(t, stolen.refreshToken).expect(200),
      REFRESH_COOKIE,
    ).value;
    await refresh(t, second).expect(200);
    await revokedAgo(stolen.refreshToken, REFRESH_REUSE_GRACE_MS + 1000);
    await refresh(t, stolen.refreshToken).expect(401);
    await expect(
      t.prisma.refreshToken.count({ where: { revokedAt: null } }),
    ).resolves.toBe(0);
    const fresh = await login(t);

    const replay = await refresh(t, stolen.refreshToken).expect(401);

    expectCleared(replay, REFRESH_COOKIE, REFRESH_COOKIE_PATH);
    // The owner's new session survives the replay.
    await refresh(t, fresh.refreshToken).expect(200);
  });

  it('answers a spent token inside the grace window with 401 and revokes nothing', async () => {
    // Two tabs, one cookie: the second refresh arrives just after the first
    // spent the token. That is not theft, and must not sign the user out.
    const t = ctx();
    const first = await register(t);
    const otherDevice = await login(t);
    const rotated = getSetCookie(
      await refresh(t, first.refreshToken).expect(200),
      REFRESH_COOKIE,
    ).value;
    await revokedAgo(first.refreshToken, REFRESH_REUSE_GRACE_MS - 2000);

    const res = await refresh(t, first.refreshToken).expect(401);

    expect((res.body as ErrorBody).message).toBe(
      'Session expired, please sign in again',
    );
    // Nothing new was issued, and nothing was cleared either: this tab
    // shares its cookie jar with the one that won, whose fresh cookies may
    // already be in it. The registration, the other device and the rotation
    // make three rows.
    expect([...parseSetCookies(res).keys()]).toEqual([]);
    await expect(t.prisma.refreshToken.count()).resolves.toBe(3);
    await expect(
      t.prisma.refreshToken.count({ where: { revokedAt: null } }),
    ).resolves.toBe(2);
    // The tab that won keeps working, and so does the other device.
    const next = await refresh(t, rotated).expect(200);
    await me(t, getSetCookie(next, ACCESS_COOKIE).value).expect(200);
    await refresh(t, otherDevice.refreshToken).expect(200);
  });

  it('a token ended by a password reset, presented long after, is just dead: the sessions opened since survive', async () => {
    // A laptop tab left open across a reset done on the phone. The tab's
    // token was revoked by the reset, not spent by a rotation, so it is not
    // evidence of theft and must not end the phone's new session.
    const t = ctx();
    const laptop = await register(t);
    const resetToken = 'reset-on-the-phone-0123456789abcdef';
    await requestReset(t, 'ada@example.com', resetToken);
    await t
      .http()
      .post(`${AUTH}/reset-password`)
      .send({ token: resetToken, password: 'the-phone-passphrase' })
      .expect(200);
    const phone = await login(t, 'ada@example.com', 'the-phone-passphrase');
    await revokedAgo(laptop.refreshToken, 60_000);

    const res = await refresh(t, laptop.refreshToken).expect(401);

    // This browser's session is over, so its cookies go.
    expectCleared(res, ACCESS_COOKIE, '/');
    expectCleared(res, REFRESH_COOKIE, REFRESH_COOKIE_PATH);
    await refresh(t, phone.refreshToken).expect(200);
  });

  it('a signed-out token presented long after does not end the other devices', async () => {
    const t = ctx();
    const signedOut = await register(t);
    const otherDevice = await login(t);
    await t
      .http()
      .post(`${AUTH}/logout`)
      .set('Cookie', `${REFRESH_COOKIE}=${signedOut.refreshToken}`)
      .expect(204);
    await revokedAgo(signedOut.refreshToken, 60_000);

    const res = await refresh(t, signedOut.refreshToken).expect(401);

    expectCleared(res, REFRESH_COOKIE, REFRESH_COOKIE_PATH);
    await refresh(t, otherDevice.refreshToken).expect(200);
  });

  it('answers a missing cookie with 401 and clears both cookies', async () => {
    const res = await ctx().http().post(`${AUTH}/refresh`).expect(401);

    expect((res.body as ErrorBody).message).toBe('Not signed in');
    expectCleared(res, ACCESS_COOKIE, '/');
    expectCleared(res, REFRESH_COOKIE, REFRESH_COOKIE_PATH);
  });

  it('rejects a token whose session row has expired, without treating it as theft', async () => {
    const t = ctx();
    const expiring = await register(t);
    const otherDevice = await login(t);
    // The JWT itself is still good for 30 days; only the row says no.
    await t.prisma.refreshToken.update({
      where: { tokenHash: sha256(expiring.refreshToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await refresh(t, expiring.refreshToken).expect(401);

    expectCleared(res, REFRESH_COOKIE, REFRESH_COOKIE_PATH);
    await refresh(t, otherDevice.refreshToken).expect(200);
  });

  it('rejects a token that is not a valid JWT', async () => {
    await refresh(ctx(), 'not-a-jwt').expect(401);
  });

  it('rejects an access token presented as the refresh cookie, even signed with the refresh key and on file', async () => {
    // The refresh key signing an access-shaped token is what a shared secret
    // would allow. A session row is planted for the forged token, so the
    // lookup cannot be what refuses it: only the typ claim can.
    const t = ctx();
    const { user } = await register(t);
    const forged = new JwtService().sign(
      { sub: user.id, email: user.email, role: user.role, typ: 'access' },
      {
        secret: t.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: 3600,
      },
    );
    await t.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(forged),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const res = await refresh(t, forged).expect(401);

    expect((res.body as ErrorBody).message).toBe(
      'Session expired, please sign in again',
    );
    // Turned away before the claim: the planted row is unspent, and no
    // session was issued from it.
    expect((await rowFor(forged)).revokedAt).toBeNull();
    await expect(t.prisma.refreshToken.count()).resolves.toBe(2);
  });
});
