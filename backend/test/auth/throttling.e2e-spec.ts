import { AUTH } from '../utils/auth';
import { useTestApp } from '../utils/test-app';

// The one place throttling is exercised for real. Every other file starts each
// test with the counts cleared, so this guard never leaks between tests.
describe('rate limiting on login', () => {
  const ctx = useTestApp();

  const attempt = () =>
    ctx()
      .http()
      .post(`${AUTH}/login`)
      .send({ email: 'guess@example.com', password: 'guessing-again' });

  it('blocks the 11th attempt within a minute from one client', async () => {
    // Sequential on purpose: the count is what is under test, not ordering.
    for (let i = 1; i <= 10; i++) {
      const res = await attempt();
      expect({ attempt: i, status: res.status }).toEqual({
        attempt: i,
        status: 401,
      });
      expect(res.headers['x-ratelimit-limit']).toBe('10');
    }

    const blocked = await attempt();

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  // With no proxy in front, X-Forwarded-For is just a header the client
  // wrote. If the limiter believed it, every guess could arrive "from" a new
  // address with a fresh allowance. (trusted-proxy.e2e-spec.ts covers the
  // deployed case, TRUST_PROXY=1.)
  it('ignores X-Forwarded-For by default: rotating it does not reset the allowance', async () => {
    const t = ctx();
    expect(t.config.get('TRUST_PROXY')).toBe(0);
    expect(t.app.getHttpAdapter().getInstance().get('trust proxy')).toBe(false);

    for (let i = 1; i <= 10; i++) {
      const res = await attempt().set('X-Forwarded-For', `203.0.113.${i}`);
      expect({ attempt: i, status: res.status }).toEqual({
        attempt: i,
        status: 401,
      });
    }

    const blocked = await attempt().set('X-Forwarded-For', '203.0.113.99');

    expect(blocked.status).toBe(429);
  });

  it('starts every test with clean counts', async () => {
    // Runs after the test above has used up the allowance.
    const res = await attempt();

    expect(res.status).toBe(401);
    expect(res.headers['x-ratelimit-remaining']).toBe('9');
  });
});
