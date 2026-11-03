import { JwtService } from '@nestjs/jwt';
import { AUTH, PublicUserBody, me, register } from '../utils/auth';
import { useTestApp } from '../utils/test-app';

describe('GET /api/v1/auth/me', () => {
  const ctx = useTestApp();

  /** Signs an access token with the app's own key, so only `exp` differs. */
  function signAccessToken(
    payload: { sub: string; email: string; role: string },
    exp: number,
  ): string {
    return signWithAccessKey({ ...payload, typ: 'access', exp });
  }

  /** Any claims at all, signed with the key JwtStrategy checks against. */
  function signWithAccessKey(claims: Record<string, unknown>): string {
    const secret = ctx().config.getOrThrow<string>('JWT_ACCESS_SECRET');
    return new JwtService().sign(claims, { secret });
  }

  it('returns the user for a valid access cookie', async () => {
    const t = ctx();
    const { user, accessToken } = await register(t);

    const res = await me(t, accessToken).expect(200);

    expect((res.body as { user: PublicUserBody }).user).toEqual(user);
  });

  it('rejects a request with no credentials', async () => {
    await ctx().http().get(`${AUTH}/me`).expect(401);
  });

  it('accepts the token as a Bearer header for API tooling', async () => {
    const t = ctx();
    const { user, accessToken } = await register(t);

    const res = await t
      .http()
      .get(`${AUTH}/me`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect((res.body as { user: PublicUserBody }).user.id).toBe(user.id);
  });

  it('rejects a token whose payload was edited after signing', async () => {
    const t = ctx();
    const { accessToken } = await register(t);

    // The realistic tamper: promote yourself to ADMIN and keep the signature.
    const [header, payload, signature] = accessToken.split('.');
    const claims = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    ) as Record<string, unknown>;
    const forged = Buffer.from(
      JSON.stringify({ ...claims, role: 'ADMIN' }),
    ).toString('base64url');

    await me(t, `${header}.${forged}.${signature}`).expect(401);
  });

  it('rejects an access token that has expired', async () => {
    const t = ctx();
    const { user } = await register(t);
    const claims = { sub: user.id, email: user.email, role: user.role };
    const now = Math.floor(Date.now() / 1000);

    // Control: the same signer with a future expiry is accepted, so the 401
    // below can only be about expiry.
    await me(t, signAccessToken(claims, now + 60)).expect(200);
    await me(t, signAccessToken(claims, now - 60)).expect(401);
  });

  // What a shared JWT secret would let through: a refresh token whose
  // signature the access check accepts. validateEnv refuses that setting at
  // boot; the typ claim is the second line.
  it.each([
    ['typ refresh', { typ: 'refresh', jti: 'a'.repeat(48) }],
    ['no typ, as issued before the claim existed', {}],
  ])(
    'rejects a token signed with the access key but carrying %s, as a Bearer header',
    async (_label, extra) => {
      const t = ctx();
      const { user } = await register(t);
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const claims = { sub: user.id, email: user.email, role: user.role, exp };

      // Control: identical apart from typ, and accepted.
      await t
        .http()
        .get(`${AUTH}/me`)
        .set(
          'Authorization',
          `Bearer ${signWithAccessKey({ ...claims, typ: 'access' })}`,
        )
        .expect(200);
      await t
        .http()
        .get(`${AUTH}/me`)
        .set(
          'Authorization',
          `Bearer ${signWithAccessKey({ ...claims, ...extra })}`,
        )
        .expect(401);
    },
  );

  it('rejects a refresh token presented as an access token', async () => {
    const t = ctx();
    const { refreshToken } = await register(t);

    // The two token kinds are signed with different keys for exactly this.
    await t
      .http()
      .get(`${AUTH}/me`)
      .set('Authorization', `Bearer ${refreshToken}`)
      .expect(401);
  });
});
