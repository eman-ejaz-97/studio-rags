/**
 * Preloaded into the self-hosted frontend server by frontend/Dockerfile:
 *
 *   node --import ./forwarded-for.mjs server.js
 *
 * The API works out who a visitor is from X-Forwarded-For, believing only the
 * last TRUST_PROXY entries: the ones the proxies in front of it wrote. Next's
 * standalone server proxies /api/v1 to the API without adding the address of
 * whoever connected to it, and passes on any X-Forwarded-For the visitor wrote
 * themselves. Behind it, the API either saw every visitor as this container
 * (one shared login allowance for everybody) or, trusting one hop, believed an
 * address the visitor made up (a fresh allowance per made-up address).
 *
 * This makes the server behave like any other proxy: it appends the address
 * of the connection it accepted, so the last entry is one it wrote and a
 * visitor cannot forge. Count this container as one hop in TRUST_PROXY.
 *
 * Vercel never runs this file. Its edge performs the rewrite and writes
 * X-Forwarded-For itself.
 */
import diagnosticsChannel from "node:diagnostics_channel";

/** How an IPv4 client appears on a socket that also accepts IPv6. */
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/**
 * The X-Forwarded-For a proxy sends on: what arrived, plus the address that
 * connected. Returns `existing` untouched when the peer is unknown (a socket
 * already closed), rather than inventing an entry.
 *
 * @param {string | string[] | undefined} existing
 * @param {string | undefined} peer
 * @returns {string | string[] | undefined}
 */
export function appendForwardedFor(existing, peer) {
  if (!peer) return existing;
  const address = peer.replace(IPV4_MAPPED, "$1");
  const prior = Array.isArray(existing) ? existing.join(", ") : existing;
  return prior && prior.trim() !== "" ? `${prior}, ${address}` : address;
}

// Node publishes on this channel for every request, synchronously and before
// the server emits "request" to Next, so Next and its proxy only ever see the
// rewritten header. Held in a module-level constant so the channel, and with
// it the subscription, lives as long as the process.
const requestStart = diagnosticsChannel.channel("http.server.request.start");

requestStart.subscribe(({ request, socket }) => {
  const value = appendForwardedFor(
    request.headers["x-forwarded-for"],
    socket?.remoteAddress,
  );
  if (value !== undefined) request.headers["x-forwarded-for"] = value;
});
