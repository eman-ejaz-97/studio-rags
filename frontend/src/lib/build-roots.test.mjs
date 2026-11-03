// Run with `npm test` (node --test). Node strips the TypeScript types from
// build-roots.ts as it loads it, so this exercises the file next.config uses.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pinnedRoots } from "./build-roots.ts";

const DIR = "/work/studio_rags/frontend";

describe("pinnedRoots", () => {
  it("pins both roots to the frontend directory off Vercel", () => {
    assert.deepEqual(pinnedRoots(DIR, {}), {
      turbopack: { root: DIR },
      outputFileTracingRoot: DIR,
    });
  });

  it("pins nothing on Vercel, so its build adapter can find .next", () => {
    assert.deepEqual(pinnedRoots(DIR, { VERCEL: "1" }), {});
  });

  it("treats an empty VERCEL as not on Vercel", () => {
    assert.equal(pinnedRoots(DIR, { VERCEL: "" }).outputFileTracingRoot, DIR);
  });
});
