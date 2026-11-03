import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  REFRESH_COOKIE_PATH,
} from '../../src/auth/auth.cookies';
import {
  AUTH,
  ErrorBody,
  PASSWORD,
  login,
  pinNextResetToken,
  refresh,
  register,
  requestReset,
  sha256,
} from '../utils/auth';
import { expectCleared } from '../utils/cookies';
import { useTestApp } from '../utils/test-app';

const RESET_TOKEN = 'known-reset-token-for-e2e-0123456789abcdef';
const NEW_PASSWORD = 'a-brand-new-passphrase';
const INVALID_LINK = 'That reset link is invalid or has expired';

describe('password reset', () => {
  const ctx = useTestApp();

  const resetPassword = (token: string, password = NEW_PASSWORD) =>
    ctx().http().post(`${AUTH}/reset-password`).send({ token, password });

  describe('POST /api/v1/auth/forgot-password', () => {
    it('answers known and unknown addresses identically', async () => {
      const t = ctx();
      await register(t);

      pinNextResetToken(t, RESET_TOKEN);
      const known = await t
        .http()
        .post(`${AUTH}/forgot-password`)
        .send({ email: 'ada@example.com' });
      const unknown = await t
        .http()
        .post(`${AUTH}/forgot-password`)
        .send({ email: 'nobody@example.com' });

      expect(known.status).toBe(202);
      expect(unknown.status).toBe(202);
      expect(unknown.body).toEqual(known.body);
    });

    it('stores a hash of the token for a known address, never the token', async () => {
      const t = ctx();
      const { user } = await register(t);

      await requestReset(t, 'ada@example.com', RESET_TOKEN);

      const rows = await t.prisma.passwordResetToken.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: user.id,
        tokenHash: sha256(RESET_TOKEN),
        usedAt: null,
      });
      expect(rows[0].tokenHash).not.toContain(RESET_TOKEN);
      expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    });

    it('creates nothing for an unknown address', async () => {
      const t = ctx();
      await t
        .http()
        .post(`${AUTH}/forgot-password`)
        .send({ email: 'nobody@example.com' })
        .expect(202);

      await expect(t.prisma.passwordResetToken.count()).resolves.toBe(0);
    });
  });

  describe('POST /api/v1/auth/reset-password', () => {
    it('changes the password, spends the token and ends every session', async () => {
      const t = ctx();
      const firstSession = await register(t);
      const secondSession = await login(t);
      await requestReset(t, 'ada@example.com', RESET_TOKEN);

      const res = await resetPassword(RESET_TOKEN).expect(200);

      expect(res.body).toEqual({
        message: 'Your password has been changed. Please sign in.',
      });
      expectCleared(res, ACCESS_COOKIE, '/');
      expectCleared(res, REFRESH_COOKIE, REFRESH_COOKIE_PATH);

      const token = await t.prisma.passwordResetToken.findUniqueOrThrow({
        where: { tokenHash: sha256(RESET_TOKEN) },
      });
      expect(token.usedAt).toBeInstanceOf(Date);
      await expect(
        t.prisma.refreshToken.count({ where: { revokedAt: null } }),
      ).resolves.toBe(0);
      await refresh(t, firstSession.refreshToken).expect(401);
      await refresh(t, secondSession.refreshToken).expect(401);

      await t
        .http()
        .post(`${AUTH}/login`)
        .send({ email: 'ada@example.com', password: PASSWORD })
        .expect(401);
      await login(t, 'ada@example.com', NEW_PASSWORD);
    });

    it('refuses the same token a second time', async () => {
      const t = ctx();
      await register(t);
      await requestReset(t, 'ada@example.com', RESET_TOKEN);
      await resetPassword(RESET_TOKEN).expect(200);

      const res = await resetPassword(
        RESET_TOKEN,
        'yet-another-passphrase',
      ).expect(401);

      expect((res.body as ErrorBody).message).toBe(INVALID_LINK);
      await login(t, 'ada@example.com', NEW_PASSWORD);
    });

    it('an older, unused link stops working once the password has been reset', async () => {
      // Two reset requests, the newer link used. The older one must not be
      // able to change the password again and lock the owner out.
      const t = ctx();
      await register(t);
      const olderLink = 'older-reset-link-0123456789abcdef';
      await requestReset(t, 'ada@example.com', olderLink);
      await requestReset(t, 'ada@example.com', RESET_TOKEN);
      await resetPassword(RESET_TOKEN).expect(200);

      const res = await resetPassword(olderLink, 'an-intruder-passphrase');

      expect(res.status).toBe(401);
      expect((res.body as ErrorBody).message).toBe(INVALID_LINK);
      await login(t, 'ada@example.com', NEW_PASSWORD);
      await expect(
        t.prisma.passwordResetToken.count({ where: { usedAt: null } }),
      ).resolves.toBe(0);
    });

    it('refuses an expired token and leaves the password alone', async () => {
      const t = ctx();
      await register(t);
      await requestReset(t, 'ada@example.com', RESET_TOKEN);
      await t.prisma.passwordResetToken.update({
        where: { tokenHash: sha256(RESET_TOKEN) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await resetPassword(RESET_TOKEN).expect(401);

      expect((res.body as ErrorBody).message).toBe(INVALID_LINK);
      await login(t, 'ada@example.com', PASSWORD);
    });

    it('refuses a token that was never issued', async () => {
      const t = ctx();
      await register(t);

      const res = await resetPassword('garbage-token-never-issued').expect(401);

      expect((res.body as ErrorBody).message).toBe(INVALID_LINK);
    });

    it('rejects a short new password with 400 and keeps the token usable', async () => {
      const t = ctx();
      await register(t);
      await requestReset(t, 'ada@example.com', RESET_TOKEN);

      const res = await resetPassword(RESET_TOKEN, 'short').expect(400);

      expect((res.body as ErrorBody).message).toContain(
        'Password must be at least 10 characters',
      );
      const token = await t.prisma.passwordResetToken.findUniqueOrThrow({
        where: { tokenHash: sha256(RESET_TOKEN) },
      });
      expect(token.usedAt).toBeNull();
    });
  });
});
