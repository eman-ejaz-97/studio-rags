// Run with `npm test` (node --test). Plain Node, no test framework: the file
// under test is plain Node too, and runs outside Next.
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";
import { appendForwardedFor } from "./forwarded-for.mjs";

describe("appendForwardedFor", () => {
  it("starts the header with the peer when the request carried none", () => {
    assert.equal(appendForwardedFor(undefined, "203.0.113.7"), "203.0.113.7");
    assert.equal(appendForwardedFor("", "203.0.113.7"), "203.0.113.7");
    assert.equal(appendForwardedFor("  ", "203.0.113.7"), "203.0.113.7");
  });

  it("appends the peer to whatever arrived, as a proxy does", () => {
    assert.equal(
      appendForwardedFor("198.51.100.7", "203.0.113.7"),
      "198.51.100.7, 203.0.113.7",
    );
    assert.equal(
      appendForwardedFor(["198.51.100.7", "198.51.100.8"], "203.0.113.7"),
      "198.51.100.7, 198.51.100.8, 203.0.113.7",
    );
  });

  it("writes an IPv4 client as plain IPv4, not IPv4-mapped IPv6", () => {
    assert.equal(
      appendForwardedFor(undefined, "::ffff:203.0.113.7"),
      "203.0.113.7",
    );
    assert.equal(appendForwardedFor(undefined, "2001:db8::7"), "2001:db8::7");
  });

  it("changes nothing when the peer is unknown", () => {
    assert.equal(appendForwardedFor("198.51.100.7", undefined), "198.51.100.7");
    assert.equal(appendForwardedFor(undefined, undefined), undefined);
  });
});

// The module's side effect, end to end: imported above, it is now rewriting
// the header for every HTTP server in this process, as it does for Next's.
describe("a request reaching an HTTP server in this process", () => {
  /** @type {http.Server} */
  let server;
  /** @type {number} */
  let port;

  before(async () => {
    server = http.createServer((req, res) => {
      res.end(String(req.headers["x-forwarded-for"]));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = /** @type {import("node:net").AddressInfo} */ (server.address())
      .port;
  });

  after(() => server.close());

  /** The X-Forwarded-For the handler saw, for a request with these headers. */
  const seenBy = (headers) =>
    new Promise((resolve, reject) => {
      http
        .get({ host: "127.0.0.1", port, headers }, (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve(body));
        })
        .on("error", reject);
    });

  it("already carries the connecting address when the handler runs", async () => {
    assert.equal(await seenBy({}), "127.0.0.1");
  });

  it("keeps a client-written entry, but always ends with the real peer", async () => {
    // The API trusts only the last entry from this hop, so a made-up address
    // on the left is carried along and ignored.
    assert.equal(
      await seenBy({ "x-forwarded-for": "198.51.100.7" }),
      "198.51.100.7, 127.0.0.1",
    );
  });
});
