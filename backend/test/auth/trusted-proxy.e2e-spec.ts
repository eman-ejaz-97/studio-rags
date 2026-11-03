// Must stay the first import: it sets TRUST_PROXY=1 before AppModule is
// imported and its environment validated. See the module for why.
import './support/trust-one-proxy';
import { AUTH, registerBody } from '../utils/auth';
import { useTestApp } from '../utils/test-app';

/**
 * The deployed shape: one proxy (the host's load balancer) in front of the
 * API, which appends the address it saw to X-Forwarded-For. With
 * TRUST_PROXY=1, req.ip is that last entry, and the rate limiter and session
 * records use it.
 */
describe('behind one trusted proxy (TRUST_PROXY=1)', () => {
  const ctx = useTestApp();

  const attempt = (forwardedFor: string) =>
    ctx()
      .http()
      .post(`${AUTH}/login`)
      .set('X-Forwarded-For', forwardedFor)
      .send({ email: 'guess@example.com', password: 'guessing-again' });

  it('runs with Express trusting exactly one hop', () => {
    const t = ctx();

    expect(t.config.get('TRUST_PROXY')).toBe(1);
    expect(t.app.getHttpAdapter().getInstance().get('trust proxy')).toBe(1);
  });

  it('throttles each forwarded client address independently', async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await attempt('203.0.113.10');
      expect({ attempt: i, status: res.status }).toEqual({
        attempt: i,
        status: 401,
      });
    }
    expect((await attempt('203.0.113.10')).status).toBe(429);

    // A different visitor behind the same proxy is not locked out.
    const other = await attempt('203.0.113.20');

    expect(other.status).toBe(401);
    expect(other.headers['x-ratelimit-remaining']).toBe('9');
  });

  it('believes only the entry the proxy added: rotating the client-written part changes nothing', async () => {
    // The proxy appends to whatever the client sent, so the client controls
    // everything left of the last comma and nothing else.
    for (let i = 1; i <= 10; i++) {
      const res = await attempt(`198.51.100.${i}, 203.0.113.30`);
      expect({ attempt: i, status: res.status }).toEqual({
        attempt: i,
        status: 401,
      });
    }

    const blocked = await attempt('198.51.100.99, 203.0.113.30');

    expect(blocked.status).toBe(429);
  });

  it('records the forwarded client address on the session, not the proxy', async () => {
    const t = ctx();
    await t
      .http()
      .post(`${AUTH}/register`)
      .set('X-Forwarded-For', '198.51.100.7, 203.0.113.40')
      .send(registerBody())
      .expect(201);

    const session = await t.prisma.refreshToken.findFirstOrThrow();
    expect(session.ip).toBe('203.0.113.40');
  });
});
