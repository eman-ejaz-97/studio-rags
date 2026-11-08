/**
 * The headers src/proxy.ts sends on with each /api/v1 request, so the API can
 * tell visitors apart.
 *
 * Every website request reaches the API from one of Vercel's servers, whose
 * address changes between requests, so the API cannot find the visitor by
 * counting proxy hops (SPEC § 10 item 14). Instead this names the visitor in
 * x-sr-client-ip and signs it with API_PROXY_SECRET, which the API also holds
 * (backend/src/common/client-address.ts). The API ignores the address unless
 * the secret matches, so a visitor who writes these headers gains nothing.
 *
 * Set API_PROXY_SECRET only on Vercel. Vercel overwrites x-forwarded-for with
 * the visitor's own address and does not forward one the visitor wrote. Off
 * Vercel (local dev, the Docker image) leave it unset: nothing changes, and the
 * API keeps counting by its TRUST_PROXY setting.
 */
export const CLIENT_IP_HEADER = "x-sr-client-ip";
export const PROXY_SECRET_HEADER = "x-sr-proxy-secret";

/** The request headers to send on, or null to leave the request untouched. */
export function apiProxyHeaders(
  incoming: Headers,
  env: Record<string, string | undefined> = process.env,
): Headers | null {
  const secret = env.API_PROXY_SECRET;
  if (!secret) return null;

  const headers = new Headers(incoming);
  // Whatever the visitor sent under these names is dropped, not passed on.
  headers.delete(CLIENT_IP_HEADER);
  headers.delete(PROXY_SECRET_HEADER);

  const visitor = visitorAddress(incoming);
  if (visitor) headers.set(CLIENT_IP_HEADER, visitor);
  headers.set(PROXY_SECRET_HEADER, secret);
  return headers;
}

/**
 * The last x-forwarded-for entry: the address the nearest proxy saw. On
 * Vercel there is only one. Were there ever a list, everything left of the
 * last comma could have been written by the visitor.
 */
function visitorAddress(incoming: Headers): string | null {
  const entries = (incoming.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.at(-1) ?? null;
}
