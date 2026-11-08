// Must stay the first import: it sets API_PROXY_SECRET before AppModule is
// imported and its environment validated. See the module for why.
import { TEST_PROXY_SECRET } from './support/proxy-secret';
import {
  CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
} from '../../src/common/client-address';
import { AUTH, registerBody } from '../utils/auth';
import { useTestApp } from '../utils/test-app';

/**
 * The staging shape: the frontend's proxy names each visitor in
 * x-sr-client-ip and signs it with the shared secret. Every request here
 * arrives from 127.0.0.1, as every website request reaches Render from one of
 * Vercel's servers, so only the signed header can tell visitors apart.
 */
describe('visitor address signed by the frontend proxy (API_PROXY_SECRET)', () => {
  const ctx = useTestApp();

  const attempt = (headers: Record<string, string>) =>
    ctx()
      .http()
      .post(`${AUTH}/login`)
      .set(headers)
      .send({ email: 'guess@example.com', password: 'guessing-again' });

  const signed = (ip: string) => ({
    [CLIENT_IP_HEADER]: ip,
    [PROXY_SECRET_HEADER]: TEST_PROXY_SECRET,
  });

  it('runs with the secret configured', () => {
    expect(ctx().config.get('API_PROXY_SECRET')).toBe(TEST_PROXY_SECRET);
  });

  it('throttles each signed visitor separately', async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await attempt(signed('203.0.113.10'));
      expect({ attempt: i, status: res.status }).toEqual({
        attempt: i,
        status: 401,
      });
    }
    expect((await attempt(signed('203.0.113.10'))).status).toBe(429);

    // Another visitor through the same proxy keeps a full allowance.
    const other = await attempt(signed('203.0.113.20'));

    expect(other.status).toBe(401);
    expect(other.headers['x-ratelimit-remaining']).toBe('9');
  });

  it('ignores a visitor address sent without the secret, or with a wrong one', async () => {
    // A direct caller rotating the header: each try still counts against the
    // address the connection came from.
    for (let i = 1; i <= 10; i++) {
      const res = await attempt(
        i % 2
          ? { [CLIENT_IP_HEADER]: `198.51.100.${i}` }
          : {
              [CLIENT_IP_HEADER]: `198.51.100.${i}`,
              [PROXY_SECRET_HEADER]: TEST_PROXY_SECRET.replace(/.$/, 'X'),
            },
      );
      expect({ attempt: i, status: res.status }).toEqual({
        attempt: i,
        status: 401,
      });
    }

    const blocked = await attempt({ [CLIENT_IP_HEADER]: '198.51.100.99' });

    expect(blocked.status).toBe(429);
  });

  it('records the signed visitor address on the session', async () => {
    const t = ctx();
    await t
      .http()
      .post(`${AUTH}/register`)
      .set(signed('203.0.113.40'))
      .send(registerBody())
      .expect(201);

    const session = await t.prisma.refreshToken.findFirstOrThrow();
    expect(session.ip).toBe('203.0.113.40');
  });
});
