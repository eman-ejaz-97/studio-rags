import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Request } from 'express';
import { CLIENT_IP_HEADER, PROXY_SECRET_HEADER } from '../client-address';
import { ClientThrottlerGuard } from './client-throttler.guard';

const SECRET = 'unit-test-only-proxy-secret-0123456789';

/** Opens up the protected tracker; the counting itself is the stock guard's. */
class Exposed extends ClientThrottlerGuard {
  tracker(req: Request) {
    return this.getTracker(req);
  }
}

function guardWith(secret: string | undefined) {
  const config = { get: () => secret } as unknown as ConfigService;
  return new Exposed([], {} as ThrottlerStorage, new Reflector(), config);
}

function request(headers: Record<string, string>, ip?: string) {
  return { ip, get: (name: string) => headers[name] } as unknown as Request;
}

describe('ClientThrottlerGuard', () => {
  const signed = request(
    { [CLIENT_IP_HEADER]: '203.0.113.10', [PROXY_SECRET_HEADER]: SECRET },
    '10.0.0.5',
  );

  it('counts a signed request against the visitor it names', async () => {
    await expect(guardWith(SECRET).tracker(signed)).resolves.toBe(
      '203.0.113.10',
    );
  });

  it('counts by req.ip when API_PROXY_SECRET is not configured', async () => {
    await expect(guardWith(undefined).tracker(signed)).resolves.toBe(
      '10.0.0.5',
    );
  });

  it('keys a request with no address the way the stock guard does', async () => {
    await expect(guardWith(SECRET).tracker(request({}))).resolves.toBe(
      'undefined',
    );
  });
});
