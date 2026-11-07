import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSessionClient, errorMessages, safeNext } from "./session.ts";

const USER = { id: "u1", email: "a@example.com", firstName: "A", lastName: "B" };

/** A fake API: answers by "METHOD /path" from a queue, and records each call. */
function fakeApi(routes) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const key = `${init.method ?? "GET"} ${url.replace("/api/v1", "")}`;
    calls.push(key);
    const queue = routes[key];
    if (!queue || queue.length === 0) throw new Error(`unexpected ${key}`);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const answer = typeof next === "function" ? await next() : next;
    return new Response(answer.body ? JSON.stringify(answer.body) : null, {
      status: answer.status,
    });
  };
  return { fetch, calls };
}

function memoryHint(on = false) {
  return { value: on, get() { return this.value; }, set(v) { this.value = v; } };
}

describe("request", () => {
  it("refreshes once on a 401 and retries", async () => {
    const api = fakeApi({
      "GET /auth/me": [{ status: 401 }, { status: 200, body: { user: USER } }],
      "POST /auth/refresh": [{ status: 200, body: { ok: true } }],
    });
    const client = createSessionClient(api.fetch, memoryHint());
    assert.deepEqual(await client.me(), USER);
    assert.deepEqual(api.calls, ["GET /auth/me", "POST /auth/refresh", "GET /auth/me"]);
  });

  it("retries once even when the refresh fails, then reports signed out", async () => {
    const api = fakeApi({
      "GET /auth/me": [{ status: 401 }],
      "POST /auth/refresh": [{ status: 401 }],
    });
    const hint = memoryHint(true);
    const client = createSessionClient(api.fetch, hint);
    assert.equal(await client.me(), null);
    assert.deepEqual(api.calls, ["GET /auth/me", "POST /auth/refresh", "GET /auth/me"]);
    assert.equal(hint.value, false);
  });

  it("finds the session another tab stored when this tab's refresh lost the race", async () => {
    const api = fakeApi({
      "GET /auth/me": [{ status: 401 }, { status: 200, body: { user: USER } }],
      "POST /auth/refresh": [{ status: 401 }],
    });
    const client = createSessionClient(api.fetch, memoryHint());
    assert.deepEqual(await client.me(), USER);
  });

  it("shares one refresh between requests that fail together", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const api = fakeApi({
      "GET /bookings": [{ status: 401 }, { status: 401 }, { status: 200, body: {} }],
      "POST /auth/refresh": [async () => (await gate, { status: 200, body: { ok: true } })],
    });
    const client = createSessionClient(api.fetch, memoryHint());
    const both = Promise.all([client.request("/bookings"), client.request("/bookings")]);
    await new Promise((r) => setTimeout(r, 10));
    release();
    await both;
    assert.equal(api.calls.filter((c) => c === "POST /auth/refresh").length, 1);
  });

  it("never refreshes for the sign-in route itself", async () => {
    const api = fakeApi({ "POST /auth/login": [{ status: 401 }] });
    const client = createSessionClient(api.fetch, memoryHint());
    const res = await client.post("/auth/login", { email: "a", password: "b" });
    assert.equal(res.status, 401);
    assert.deepEqual(api.calls, ["POST /auth/login"]);
  });
});

describe("signOut", () => {
  it("waits for a refresh in flight before signing out", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const api = fakeApi({
      "GET /bookings": [{ status: 401 }, { status: 200, body: {} }],
      "POST /auth/refresh": [async () => (await gate, { status: 200, body: { ok: true } })],
      "POST /auth/logout": [{ status: 204 }],
    });
    const client = createSessionClient(api.fetch, memoryHint(true));
    const pending = client.request("/bookings");
    await new Promise((r) => setTimeout(r, 10));
    const out = client.signOut();
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(!api.calls.includes("POST /auth/logout"), "logout must wait");
    release();
    await Promise.all([pending, out]);
    assert.ok(
      api.calls.indexOf("POST /auth/logout") > api.calls.indexOf("POST /auth/refresh"),
    );
  });
});

describe("meIfHinted", () => {
  it("makes no request for a visitor who never signed in", async () => {
    const api = fakeApi({});
    const client = createSessionClient(api.fetch, memoryHint(false));
    assert.equal(await client.meIfHinted(), null);
    assert.deepEqual(api.calls, []);
  });

  it("sets the hint after a successful sign-in", async () => {
    const api = fakeApi({ "POST /auth/login": [{ status: 200, body: { user: USER } }] });
    const hint = memoryHint(false);
    const client = createSessionClient(api.fetch, hint);
    await client.post("/auth/login", {});
    assert.equal(hint.value, true);
  });
});

describe("password reset", () => {
  it("clears the hint, because the API signs the account out everywhere", async () => {
    const api = fakeApi({ "POST /auth/reset-password": [{ status: 200, body: {} }] });
    const hint = memoryHint(true);
    const client = createSessionClient(api.fetch, hint);
    await client.post("/auth/reset-password", { token: "t", password: "p" });
    assert.equal(hint.value, false);
  });
});

describe("safeNext", () => {
  it("keeps a path on this site", () => {
    assert.equal(safeNext("/classes/batik-workshop"), "/classes/batik-workshop");
  });

  it("refuses anything that could leave the site", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "", null, undefined]) {
      assert.equal(safeNext(bad), "/account");
    }
  });
});

describe("errorMessages", () => {
  it("reads one message or a validation list", async () => {
    assert.deepEqual(await errorMessages(new Response(JSON.stringify({ message: "No" }))), ["No"]);
    assert.deepEqual(
      await errorMessages(new Response(JSON.stringify({ message: ["a", "b"] }))),
      ["a", "b"],
    );
    assert.deepEqual(await errorMessages(new Response("not json")), []);
  });
});
