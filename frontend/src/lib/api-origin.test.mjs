// Run with `npm test` (node --test). Node strips the TypeScript types from
// api-origin.ts as it loads it, so this exercises the file Next uses.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { apiOrigin } from "./api-origin.ts";

const VARIABLES = ["API_ORIGIN", "VERCEL", "SITE_ENV"];
const saved = Object.fromEntries(
  VARIABLES.map((name) => [name, process.env[name]]),
);

/** Sets exactly these variables for the next call, unsetting the others. */
function withEnv(values) {
  for (const name of VARIABLES) {
    if (values[name] === undefined) delete process.env[name];
    else process.env[name] = values[name];
  }
}

afterEach(() => withEnv(saved));

describe("apiOrigin", () => {
  it("falls back to the local API in development, with nothing set", () => {
    withEnv({});
    assert.equal(apiOrigin(), "http://localhost:3001");
  });

  for (const [label, env] of [
    ["on Vercel", { VERCEL: "1" }],
    ["on a staging build", { SITE_ENV: "staging" }],
    ["on a production build", { SITE_ENV: "production" }],
    ["on Vercel with an empty value", { VERCEL: "1", API_ORIGIN: "" }],
  ]) {
    it(`refuses a missing API_ORIGIN ${label}`, () => {
      withEnv(env);
      assert.throws(() => apiOrigin(), /API_ORIGIN is not set/);
    });
  }

  it("returns the origin alone, whatever path came with it", () => {
    withEnv({
      VERCEL: "1",
      API_ORIGIN: "https://studio-rags-api.onrender.com/api/v1/",
    });
    assert.equal(apiOrigin(), "https://studio-rags-api.onrender.com");
  });

  it("refuses a value that is not an http(s) URL", () => {
    withEnv({ API_ORIGIN: "studio-rags-api.onrender.com" });
    assert.throws(() => apiOrigin(), /must be a full URL/);
    withEnv({ API_ORIGIN: "ftp://studio-rags-api.onrender.com" });
    assert.throws(() => apiOrigin(), /must use http or https/);
  });
});
