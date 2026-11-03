/**
 * Where the NestJS API lives, as seen from the Next.js server.
 *
 * Read in two places: next.config.ts (the /api/v1 rewrite) and server
 * components that call the API directly. Keeping one reader means the proxy
 * and the server-side fetches can never point at different APIs.
 *
 * Server-side only, so deliberately not NEXT_PUBLIC_. The browser never learns
 * this address: it only ever calls /api/v1 on the frontend's own origin.
 */
const LOCAL_API_ORIGIN = "http://localhost:3001";

export function apiOrigin(): string {
  // A deployed build must name its API. Vercel sets VERCEL on every build,
  // and every deploy sets SITE_ENV; without this check a forgotten API_ORIGIN
  // gives a green deploy whose /api/v1 proxy points at a localhost that does
  // not exist there, and a status page that says "waking up" for ever.
  // (frontend/Dockerfile refuses the same mistake before the build starts.)
  const deployed = Boolean(process.env.VERCEL || process.env.SITE_ENV);
  if (deployed && !process.env.API_ORIGIN) {
    throw new Error(
      "API_ORIGIN is not set. Deployed builds must name the API, e.g. https://studio-rags-api.onrender.com.",
    );
  }

  // || rather than ??, so an empty value falls back to the local default
  // instead of producing a relative URL.
  const raw = process.env.API_ORIGIN || LOCAL_API_ORIGIN;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `API_ORIGIN must be a full URL such as https://studio-rags-api.onrender.com, got "${raw}".`,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`API_ORIGIN must use http or https, got "${raw}".`);
  }

  // Origin only: a stray path or trailing slash would double up in
  // `${apiOrigin()}/api/v1/...`.
  return url.origin;
}
