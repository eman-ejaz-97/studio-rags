import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../src/auth/auth.cookies';
import { AuthService } from '../../src/auth/auth.service';
import {
  AUTH,
  PASSWORD,
  me,
  refresh,
  register,
  requestReset,
  sha256,
} from '../utils/auth';
import { getSetCookie, parseSetCookies } from '../utils/cookies';
import {
  sleep,
  slowResetLinkUpdates,
  slowSessionInserts,
} from '../utils/slow-session-inserts';
import { useTestApp } from '../utils/test-app';

/**
 * Single-use tokens under a race. These began as it.failing
 * characterisations: AuthService used to read the row, check it in
 * JavaScript, then write, with nothing atomic in between. Each token is now
 * spent by a conditional UPDATE that only one request can win.
 *
 * Before the fix, across 52 samples of the refresh race:
 *  - first race on a fresh app: [200, 401], and reuse detection then
 *    revoked the winner's new session too, signing the user out of every
 *    device (12/12);
 *  - warm connection pool: [200, 200], one refresh token forked into two
 *    live sessions, which also defeats reuse detection for a stolen token
 *    (40/40).
 * And the reset race was [200, 200] every time (27/27), the password ending
 * up as whichever write committed last.
 */
describe('concurrent use of single-use tokens', () => {
  const ctx = useTestApp();

  // The case is two browser tabs refreshing together when the access token
  // runs out.
  it('two refreshes racing with the same token: one wins, one gets 401, the winner keeps a working session', async () => {
    const t = ctx();
    const { refreshToken } = await register(t);

    const results = await Promise.all([
      refresh(t, refreshToken),
      refresh(t, refreshToken),
    ]);
    const winner = results.find((r) => r.status === 200);
    const winnerFollowUp = winner
      ? (await refresh(t, getSetCookie(winner, REFRESH_COOKIE).value)).status
      : null;

    expect({
      statuses: results.map((r) => r.status).sort(),
      winnerFollowUp,
    }).toEqual({ statuses: [200, 401], winnerFollowUp: 200 });
  });

  it("the losing refresh's 401 leaves the cookies alone, so it cannot wipe the winner's", async () => {
    // Both tabs share one cookie jar. If the loser's answer arrived second
    // and cleared the jar, the user would be signed out in the browser while
    // the winner's session was still perfectly valid.
    const t = ctx();
    const { refreshToken } = await register(t);

    const results = await Promise.all([
      refresh(t, refreshToken),
      refresh(t, refreshToken),
    ]);
    const loser = results.find((r) => r.status === 401);
    const winner = results.find((r) => r.status === 200);
    if (!loser || !winner) {
      throw new Error(
        `Expected one 200 and one 401, got ${results.map((r) => r.status).join(', ')}`,
      );
    }

    expect([...parseSetCookies(loser).keys()]).toEqual([]);
    // The winner's cookies, as the jar holds them, still work.
    const jar = getSetCookie(winner, REFRESH_COOKIE).value;
    const next = await refresh(t, jar).expect(200);
    await me(t, getSetCookie(next, ACCESS_COOKIE).value).expect(200);
  });

  it('a burst of refreshes with one token issues exactly one session', async () => {
    const t = ctx();
    const { refreshToken } = await register(t);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => refresh(t, refreshToken)),
    );

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(7);
    // The registration's row, spent, plus the one the winner created.
    // Nothing forked, and the losers revoked nothing on the way out.
    await expect(t.prisma.refreshToken.count()).resolves.toBe(2);
    await expect(
      t.prisma.refreshToken.count({ where: { revokedAt: null } }),
    ).resolves.toBe(1);
  });

  it('two password resets racing with the same token: exactly one succeeds', async () => {
    const t = ctx();
    await register(t);
    const token = 'race-reset-token-0123456789abcdef';
    await requestReset(t, 'ada@example.com', token);

    const results = await Promise.all(
      ['first-new-passphrase', 'second-new-passphrase'].map((password) =>
        t.http().post(`${AUTH}/reset-password`).send({ token, password }),
      ),
    );

    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('after a reset race, the password is the winner’s, and the loser changed nothing', async () => {
    const t = ctx();
    await register(t);
    const token = 'race-reset-token-fedcba9876543210';
    await requestReset(t, 'ada@example.com', token);
    const passwords = ['first-new-passphrase', 'second-new-passphrase'];

    const results = await Promise.all(
      passwords.map((password) =>
        t.http().post(`${AUTH}/reset-password`).send({ token, password }),
      ),
    );

    const winning = passwords[results.findIndex((r) => r.status === 200)];
    const losing = passwords.find((p) => p !== winning);
    await t
      .http()
      .post(`${AUTH}/login`)
      .send({ email: 'ada@example.com', password: winning })
      .expect(200);
    await t
      .http()
      .post(`${AUTH}/login`)
      .send({ email: 'ada@example.com', password: losing })
      .expect(401);
    const row = await t.prisma.passwordResetToken.findUniqueOrThrow({
      where: { tokenHash: sha256(token) },
    });
    expect(row.usedAt).toBeInstanceOf(Date);
  });
});

/**
 * A password reset ends every session. These line a reset up against a
 * session write that is already in flight, which is what an attacker holding
 * a stolen refresh token, and refreshing in a loop, would aim for.
 *
 * Before the fix the write landed just after the reset's revoke and survived
 * it: with a 400 ms insert, every time; with no delay at all, in 8 to 9 of 40
 * tries. Now both run under the user's row lock, one after the other.
 */
describe('a password reset racing a session that is being written', () => {
  const ctx = useTestApp();
  const RESET_TOKEN = 'race-reset-in-flight-0123456789abcdef';
  const NEW_PASSWORD = 'a-brand-new-passphrase';
  /** How long each refresh_tokens insert takes while the race is on. */
  const INSERT_MS = 400;

  let stopSlowInserts: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await stopSlowInserts?.();
    stopSlowInserts = undefined;
  });

  const resetPassword = () =>
    ctx()
      .http()
      .post(`${AUTH}/reset-password`)
      .send({ token: RESET_TOKEN, password: NEW_PASSWORD });

  it('a refresh already writing its new session: the reset revokes that session too', async () => {
    const t = ctx();
    const { refreshToken } = await register(t);
    await requestReset(t, 'ada@example.com', RESET_TOKEN);
    stopSlowInserts = await slowSessionInserts(t.prisma, INSERT_MS);

    const refreshing = refresh(t, refreshToken).then((res) => res);
    // By now the refresh has spent the old token and is writing the new one.
    await sleep(150);
    const reset = await resetPassword();
    const refreshed = await refreshing;
    await stopSlowInserts();

    // The refresh got there first, so it did hand out a new token...
    expect({ refresh: refreshed.status, reset: reset.status }).toEqual({
      refresh: 200,
      reset: 200,
    });
    // ...and the reset, which waited for it, revoked that token as well.
    await expect(
      t.prisma.refreshToken.count({ where: { revokedAt: null } }),
    ).resolves.toBe(0);
    await refresh(t, getSetCookie(refreshed, REFRESH_COOKIE).value).expect(401);
  });

  it('a sign-in with the old password already under way: no session outlives the reset', async () => {
    const t = ctx();
    await register(t);
    await requestReset(t, 'ada@example.com', RESET_TOKEN);
    stopSlowInserts = await slowSessionInserts(t.prisma, INSERT_MS);

    const signingIn = t
      .http()
      .post(`${AUTH}/login`)
      .send({ email: 'ada@example.com', password: PASSWORD })
      .then((res) => res);
    // Past the password check, which takes argon2 a moment.
    await sleep(200);
    const reset = await resetPassword();
    const signedIn = await signingIn;
    await stopSlowInserts();

    expect(reset.status).toBe(200);
    // Either the sign-in wrote first and the reset revoked it (200), or the
    // reset went first and the sign-in saw the new password hash (401).
    // Both are correct; a live session afterwards is not.
    expect([200, 401]).toContain(signedIn.status);
    await expect(
      t.prisma.refreshToken.count({ where: { revokedAt: null } }),
    ).resolves.toBe(0);
    await t
      .http()
      .post(`${AUTH}/login`)
      .send({ email: 'ada@example.com', password: PASSWORD })
      .expect(401);
  });
});

/**
 * Someone asks for a reset link twice, then opens both emails at once. Each
 * request spends its own link and, on success, voids the user's other unused
 * links. Without the user's row lock first, each holds its own link while the
 * winner, voiding, waits for the loser's link and the loser waits for the user
 * row the winner just updated. Postgres breaks the deadlock by failing one
 * request, which reached the user as a 500: in review, 39 of 40 unslowed
 * tries. Slowing each link update, with its row lock held, makes the two
 * overlap every time.
 */
describe('two different reset links for one account, used at once', () => {
  const ctx = useTestApp();
  /** How long each password_reset_tokens update takes while the race is on. */
  const UPDATE_MS = 300;
  const LINKS = [
    'two-links-first-0123456789abcdef',
    'two-links-second-0123456789abcdef',
  ];
  const PASSWORDS = ['first-new-passphrase', 'second-new-passphrase'];

  let stopSlowUpdates: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await stopSlowUpdates?.();
    stopSlowUpdates = undefined;
  });

  it('one succeeds, the other is refused, and neither fails with a deadlock', async () => {
    const t = ctx();
    await register(t);
    for (const link of LINKS) {
      await requestReset(t, 'ada@example.com', link);
    }
    stopSlowUpdates = await slowResetLinkUpdates(t.prisma, UPDATE_MS);

    const results = await Promise.all(
      LINKS.map((token, i) =>
        t
          .http()
          .post(`${AUTH}/reset-password`)
          .send({ token, password: PASSWORDS[i] }),
      ),
    );
    await stopSlowUpdates();

    // 401, not 500: the second waited for the first, then found its link
    // already voided.
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    const winning = PASSWORDS[results.findIndex((r) => r.status === 200)];
    const losing = PASSWORDS.find((password) => password !== winning);
    await t
      .http()
      .post(`${AUTH}/login`)
      .send({ email: 'ada@example.com', password: winning })
      .expect(200);
    await t
      .http()
      .post(`${AUTH}/login`)
      .send({ email: 'ada@example.com', password: losing })
      .expect(401);
    // Both links are spent: the winner's by use, the other voided by it.
    await expect(
      t.prisma.passwordResetToken.count({ where: { usedAt: null } }),
    ).resolves.toBe(0);
  });
});

/**
 * The sign-in re-reads the password hash under the user's lock before writing
 * its session. This puts a whole password reset in the gap between the argon2
 * check and that write, every time, rather than hoping the timing lands there.
 */
describe('a password reset that commits between a sign-in’s password check and its session write', () => {
  const ctx = useTestApp();
  const RESET_TOKEN = 'reset-in-the-gap-0123456789abcdef';

  it('the sign-in is refused, and no session outlives the reset', async () => {
    const t = ctx();
    await register(t);
    await requestReset(t, 'ada@example.com', RESET_TOKEN);
    const auth = t.app.get(AuthService);
    const validate = auth.validateCredentials.bind(auth);
    jest
      .spyOn(auth, 'validateCredentials')
      .mockImplementationOnce(async (email, password) => {
        // The old password checks out against the old hash...
        const user = await validate(email, password);
        // ...and then the reset lands before the session is written.
        await t
          .http()
          .post(`${AUTH}/reset-password`)
          .send({ token: RESET_TOKEN, password: 'a-brand-new-passphrase' })
          .expect(200);
        return user;
      });

    const res = await t
      .http()
      .post(`${AUTH}/login`)
      .send({ email: 'ada@example.com', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(parseSetCookies(res).has(REFRESH_COOKIE)).toBe(false);
    await expect(
      t.prisma.refreshToken.count({ where: { revokedAt: null } }),
    ).resolves.toBe(0);
  });
});
