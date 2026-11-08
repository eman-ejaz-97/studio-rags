// Run with `npm test` (node --test). Node strips the TypeScript types from
// api-proxy-headers.ts as it loads it, so this exercises the file proxy.ts uses.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
  apiProxyHeaders,
} from "./api-proxy-headers.ts";

const SECRET = "unit-test-only-proxy-secret-0123456789";
const ON = { API_PROXY_SECRET: SECRET };

describe("apiProxyHeaders", () => {
  it("leaves the request alone when no secret is set", () => {
    const incoming = new Headers({ "x-forwarded-for": "203.0.113.10" });

    assert.equal(apiProxyHeaders(incoming, {}), null);
    assert.equal(apiProxyHeaders(incoming, { API_PROXY_SECRET: "" }), null);
  });

  it("names the visitor and signs it", () => {
    const out = apiProxyHeaders(new Headers({ "x-forwarded-for": "203.0.113.10" }), ON);

    assert.equal(out.get(CLIENT_IP_HEADER), "203.0.113.10");
    assert.equal(out.get(PROXY_SECRET_HEADER), SECRET);
  });

  it("drops a visitor's own copies of both headers", () => {
    const out = apiProxyHeaders(
      new Headers({
        "x-forwarded-for": "203.0.113.10",
        [CLIENT_IP_HEADER]: "198.51.100.7",
        [PROXY_SECRET_HEADER]: "guessed",
      }),
      ON,
    );

    assert.equal(out.get(CLIENT_IP_HEADER), "203.0.113.10");
    assert.equal(out.get(PROXY_SECRET_HEADER), SECRET);
  });

  it("takes the last entry if a list ever arrives", () => {
    const out = apiProxyHeaders(
      new Headers({ "x-forwarded-for": "198.51.100.7, 203.0.113.10 " }),
      ON,
    );

    assert.equal(out.get(CLIENT_IP_HEADER), "203.0.113.10");
  });

  it("sends no visitor address when it has none, so the API falls back", () => {
    const out = apiProxyHeaders(new Headers({ [CLIENT_IP_HEADER]: "198.51.100.7" }), ON);

    assert.equal(out.has(CLIENT_IP_HEADER), false);
    assert.equal(out.get(PROXY_SECRET_HEADER), SECRET);
  });

  it("keeps every other header, cookies included", () => {
    const out = apiProxyHeaders(
      new Headers({ cookie: "sr_access=abc", "content-type": "application/json" }),
      ON,
    );

    assert.equal(out.get("cookie"), "sr_access=abc");
    assert.equal(out.get("content-type"), "application/json");
  });
});
