import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { Request } from 'express';

/** The visitor's address, written by the frontend's proxy (frontend/src/proxy.ts). */
export const CLIENT_IP_HEADER = 'x-sr-client-ip';

/** Proves CLIENT_IP_HEADER came from the frontend's proxy and not the caller. */
export const PROXY_SECRET_HEADER = 'x-sr-proxy-secret';

/**
 * Who a request is from, for the rate limits and the session record.
 *
 * Through the website, a request passes Vercel and then Render's own proxies,
 * and Vercel's outbound address changes between requests. No TRUST_PROXY hop
 * count found the visitor on that route without also letting a direct caller
 * of the onrender.com address pick its own (SPEC § 10 item 14). So the
 * frontend's proxy names the visitor in CLIENT_IP_HEADER and signs it with the
 * shared API_PROXY_SECRET.
 *
 * The header is believed only when the secret matches and the value is an IP
 * address. Anything else, including every direct call, falls back to req.ip,
 * which TRUST_PROXY still governs.
 */
export function clientAddress(
  req: Pick<Request, 'ip' | 'get'>,
  proxySecret: string | undefined,
): string | undefined {
  if (!proxySecret) return req.ip;
  if (!secretMatches(req.get(PROXY_SECRET_HEADER), proxySecret)) return req.ip;

  // A header sent twice arrives joined with ", ", which isIP refuses.
  const claimed = req.get(CLIENT_IP_HEADER)?.trim();
  if (!claimed || isIP(claimed) === 0) return req.ip;
  return claimed;
}

function secretMatches(
  presented: string | undefined,
  expected: string,
): boolean {
  if (presented === undefined) return false;
  const given = Buffer.from(presented);
  const wanted = Buffer.from(expected);
  // timingSafeEqual throws on buffers of different lengths. Checking the
  // length first gives away only the length, which is not the secret.
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}
