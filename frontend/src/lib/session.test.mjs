import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CSRF_HEADER,
  CSRF_PROBLEM,
  cookieValue,
  createSessionClient,
  errorMessages,
  isCsrfRefusal,
  safeNext,
  withCsrf,
} from "./session.ts";

const USER = { id: "u1", email: "a@example.com", firstName: "A", lastName: "B" };

/**
 * A fake API: answers by "METHOD /path" from a queue, and records each call,
 * with the CSRF header it carried (null for none) in `tokens` and its body in
 * `bodies`.
 */
function fakeApi(routes) {
  const calls = [];
  const tokens = [];
  const bodies = [];
  const fetch = async (url, init = {}) => {
    const key = `${init.method ?? "GET"} ${url.replace("/api/v1", "")}`;
    calls.push(key);
    tokens.push(new Headers(init.headers).get(CSRF_HEADER));
    bodies.push(init.body ?? null);
    const queue = routes[key];
    if (!queue || queue.length === 0) throw new Error(`unexpected ${key}`);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const answer = typeof next === "function" ? await next() : next;
    return new Response(answer.body ? JSON.stringify(answer.body) : null, {
      status: answer.status,
    });
  };
  return { fetch, calls, tokens, bodies };
}

/** The browser's CSRF cookie. Fake answers set `jar.value` as Set-Cookie would. */
function cookieJar(value = null) {
  const jar = { value };
  jar.read = () => jar.value;
  return jar;
}

const T1 = "token-one-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const T2 = "token-two-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/** The API's answer to GET /auth/csrf: sets the cookie, and says the token. */
const issues = (jar, token) => () => {
  jar.value = token;
  return { status: 200, body: { csrfToken: token } };
};

const REFUSED = { status: 403, body: { type: CSRF_PROBLEM, status: 403 } };

/** The hint holds the signed-in first name, or null for a visitor. */
function memoryHint(name = null) {
  return { value: name, get() { return this.value; }, set(v) { this.value = v; } };
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
    const hint = memoryHint("A");
    const client = createSessionClient(api.fetch, hint);
    assert.equal(await client.me(), null);
    assert.deepEqual(api.calls, ["GET /auth/me", "POST /auth/refresh", "GET /auth/me"]);
    assert.equal(hint.value, null);
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
    const client = createSessionClient(api.fetch, memoryHint("A"));
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

  it("forgets the first name", async () => {
    const api = fakeApi({ "POST /auth/logout": [{ status: 204 }] });
    const hint = memoryHint("A");
    await createSessionClient(api.fetch, hint).signOut();
    assert.equal(hint.value, null);
  });
});

describe("meIfHinted", () => {
  it("makes no request for a visitor who never signed in", async () => {
    const api = fakeApi({});
    const client = createSessionClient(api.fetch, memoryHint());
    assert.equal(await client.meIfHinted(), null);
    assert.deepEqual(api.calls, []);
  });

  it("checks with the API even when the hinted name is unknown", async () => {
    const api = fakeApi({ "GET /auth/me": [{ status: 200, body: { user: USER } }] });
    const hint = memoryHint("");
    const client = createSessionClient(api.fetch, hint);
    assert.deepEqual(await client.meIfHinted(), USER);
    assert.equal(hint.value, "A");
  });

  it("stores the first name after a successful sign-in, and the caller can still read the answer", async () => {
    const api = fakeApi({ "POST /auth/login": [{ status: 200, body: { user: USER } }] });
    const hint = memoryHint();
    const client = createSessionClient(api.fetch, hint);
    const res = await client.post("/auth/login", {});
    assert.equal(hint.value, "A");
    assert.equal((await res.json()).user.firstName, "A");
  });

  it("stores the first name after registering", async () => {
    const api = fakeApi({ "POST /auth/register": [{ status: 201, body: { user: USER } }] });
    const hint = memoryHint();
    await createSessionClient(api.fetch, hint).post("/auth/register", {});
    assert.equal(hint.value, "A");
  });

  it("leaves the hint alone after a failed sign-in", async () => {
    const api = fakeApi({ "POST /auth/login": [{ status: 401 }] });
    const hint = memoryHint();
    await createSessionClient(api.fetch, hint).post("/auth/login", {});
    assert.equal(hint.value, null);
  });

  it("keeps the hinted name when the API cannot be reached", async () => {
    const hint = memoryHint("A");
    const client = createSessionClient(async () => {
      throw new TypeError("fetch failed");
    }, hint);
    await assert.rejects(client.meIfHinted());
    assert.equal(hint.value, "A");
  });
});

describe("password reset", () => {
  it("clears the hint, because the API signs the account out everywhere", async () => {
    const api = fakeApi({ "POST /auth/reset-password": [{ status: 200, body: {} }] });
    const hint = memoryHint("A");
    const client = createSessionClient(api.fetch, hint);
    await client.post("/auth/reset-password", { token: "t", password: "p" });
    assert.equal(hint.value, null);
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

describe("withCsrf", () => {
  const post = (body = { name: "Jane" }) => ({ method: "POST", body: JSON.stringify(body) });

  it("sends the cookie's token with a write, and asks for nothing more", async () => {
    const api = fakeApi({ "POST /contact": [{ status: 202 }] });
    const send = withCsrf(api.fetch, cookieJar(T1).read);

    const res = await send("/api/v1/contact", post());

    assert.equal(res.status, 202);
    assert.deepEqual(api.calls, ["POST /contact"]);
    assert.deepEqual(api.tokens, [T1]);
  });

  it("sends PUT, PATCH and DELETE with the token too", async () => {
    const api = fakeApi({
      "PUT /x": [{ status: 200 }],
      "PATCH /x": [{ status: 200 }],
      "DELETE /x": [{ status: 200 }],
    });
    const send = withCsrf(api.fetch, cookieJar(T1).read);

    for (const method of ["PUT", "PATCH", "DELETE"]) await send("/api/v1/x", { method });

    assert.deepEqual(api.tokens, [T1, T1, T1]);
  });

  it("leaves reads alone, and asks for no token even when there is none", async () => {
    const api = fakeApi({ "GET /workshops": [{ status: 200, body: [] }] });
    const send = withCsrf(api.fetch, cookieJar().read);

    await send("/api/v1/workshops");

    assert.deepEqual(api.calls, ["GET /workshops"]);
    assert.deepEqual(api.tokens, [null]);
  });

  it("asks the API for a token first when the browser has none", async () => {
    const jar = cookieJar();
    const api = fakeApi({
      "GET /auth/csrf": [issues(jar, T1)],
      "POST /contact": [{ status: 202 }],
    });

    const res = await withCsrf(api.fetch, jar.read)("/api/v1/contact", post());

    assert.equal(res.status, 202);
    assert.deepEqual(api.calls, ["GET /auth/csrf", "POST /contact"]);
    assert.equal(api.tokens[1], T1);
  });

  it("shares one token request between writes that start together", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const jar = cookieJar();
    const api = fakeApi({
      "GET /auth/csrf": [async () => (await gate, issues(jar, T1)())],
      "POST /contact": [{ status: 202 }],
    });
    const send = withCsrf(api.fetch, jar.read);

    const both = Promise.all([send("/api/v1/contact", post()), send("/api/v1/contact", post())]);
    await new Promise((r) => setTimeout(r, 10));
    release();
    await both;

    assert.equal(api.calls.filter((c) => c === "GET /auth/csrf").length, 1);
    assert.deepEqual(api.tokens.slice(1), [T1, T1]);
  });

  it("recovers from a refusal once: a fresh token, then the same request again", async () => {
    const jar = cookieJar(T1);
    const api = fakeApi({
      "POST /contact": [REFUSED, { status: 202 }],
      "GET /auth/csrf": [issues(jar, T2)],
    });

    const res = await withCsrf(api.fetch, jar.read)("/api/v1/contact", post({ name: "Jane" }));

    assert.equal(res.status, 202);
    assert.deepEqual(api.calls, ["POST /contact", "GET /auth/csrf", "POST /contact"]);
    assert.deepEqual(api.tokens, [T1, null, T2]);
    assert.equal(api.bodies[2], api.bodies[0]);
  });

  it("hands a second refusal back to the caller rather than trying for ever", async () => {
    const jar = cookieJar(T1);
    const api = fakeApi({
      "POST /contact": [REFUSED],
      "GET /auth/csrf": [issues(jar, T2)],
    });

    const res = await withCsrf(api.fetch, jar.read)("/api/v1/contact", post());

    assert.equal(res.status, 403);
    assert.equal(await isCsrfRefusal(res), true);
    assert.deepEqual(api.calls, ["POST /contact", "GET /auth/csrf", "POST /contact"]);
  });

  it("does not retry a 403 that is not about the token", async () => {
    const api = fakeApi({
      "POST /admin/x": [{ status: 403, body: { message: "You do not have access to this resource" } }],
    });

    const res = await withCsrf(api.fetch, cookieJar(T1).read)("/api/v1/admin/x", post());

    assert.equal(res.status, 403);
    assert.deepEqual(api.calls, ["POST /admin/x"]);
    // The caller can still read the refusal.
    assert.deepEqual(await errorMessages(res), ["You do not have access to this resource"]);
  });

  it("never shows the token to another address", async () => {
    const api = fakeApi({ "POST https://elsewhere.example/hook": [{ status: 200 }] });

    await withCsrf(api.fetch, cookieJar(T1).read)("https://elsewhere.example/hook", post());

    assert.deepEqual(api.tokens, [null]);
  });

  it("lets a network failure reach the caller, so the form can say it is offline", async () => {
    const send = withCsrf(async () => {
      throw new TypeError("fetch failed");
    }, cookieJar().read);

    await assert.rejects(send("/api/v1/contact", post()), TypeError);
  });
});

describe("withCsrf inside the session client", () => {
  const clientWith = (api, jar, hint = memoryHint()) =>
    createSessionClient(withCsrf(api.fetch, jar.read), hint);

  it("sends the token with sign-in, so another site cannot sign a visitor in", async () => {
    const api = fakeApi({ "POST /auth/login": [{ status: 200, body: { user: USER } }] });

    await clientWith(api, cookieJar(T1)).post("/auth/login", { email: "a", password: "b" });

    assert.deepEqual(api.tokens, [T1]);
  });

  it("uses the new token sign-in set for the very next write", async () => {
    const jar = cookieJar(T1);
    const api = fakeApi({
      "POST /auth/login": [
        () => {
          jar.value = T2;
          return { status: 200, body: { user: USER } };
        },
      ],
      "POST /contact": [{ status: 202 }],
    });
    const client = clientWith(api, jar);

    await client.post("/auth/login", {});
    await client.post("/contact", {});

    assert.deepEqual(api.tokens, [T1, T2]);
  });

  it("keeps the refresh rules: the refresh carries the token, then the request is retried", async () => {
    const api = fakeApi({
      "GET /auth/me": [{ status: 401 }, { status: 200, body: { user: USER } }],
      "POST /auth/refresh": [{ status: 200, body: { ok: true } }],
    });

    assert.deepEqual(await clientWith(api, cookieJar(T1)).me(), USER);
    assert.deepEqual(api.calls, ["GET /auth/me", "POST /auth/refresh", "GET /auth/me"]);
    assert.deepEqual(api.tokens, [null, T1, null]);
  });

  it("still makes one refresh, and one token request, for requests that fail together", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const jar = cookieJar();
    const api = fakeApi({
      "GET /bookings": [{ status: 401 }, { status: 401 }, { status: 200, body: {} }],
      "GET /auth/csrf": [issues(jar, T1)],
      "POST /auth/refresh": [async () => (await gate, { status: 200, body: { ok: true } })],
    });
    const client = clientWith(api, jar);

    const both = Promise.all([client.request("/bookings"), client.request("/bookings")]);
    await new Promise((r) => setTimeout(r, 10));
    release();
    await both;

    assert.equal(api.calls.filter((c) => c === "POST /auth/refresh").length, 1);
    assert.equal(api.calls.filter((c) => c === "GET /auth/csrf").length, 1);
  });

  it("recovers a refused refresh before deciding the visitor is signed out", async () => {
    const jar = cookieJar(T1);
    const api = fakeApi({
      "GET /auth/me": [{ status: 401 }, { status: 200, body: { user: USER } }],
      "POST /auth/refresh": [REFUSED, { status: 200, body: { ok: true } }],
      "GET /auth/csrf": [issues(jar, T2)],
    });

    assert.deepEqual(await clientWith(api, jar).me(), USER);
    assert.deepEqual(api.calls, [
      "GET /auth/me",
      "POST /auth/refresh",
      "GET /auth/csrf",
      "POST /auth/refresh",
      "GET /auth/me",
    ]);
  });

  it("sends the token with sign-out, after waiting for a refresh in flight", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const api = fakeApi({
      "GET /bookings": [{ status: 401 }, { status: 200, body: {} }],
      "POST /auth/refresh": [async () => (await gate, { status: 200, body: { ok: true } })],
      "POST /auth/logout": [{ status: 204 }],
    });
    const client = clientWith(api, cookieJar(T1), memoryHint("A"));

    const pending = client.request("/bookings");
    await new Promise((r) => setTimeout(r, 10));
    const out = client.signOut();
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(!api.calls.includes("POST /auth/logout"), "logout must wait");
    release();
    await Promise.all([pending, out]);

    const logout = api.calls.indexOf("POST /auth/logout");
    assert.ok(logout > api.calls.indexOf("POST /auth/refresh"));
    assert.equal(api.tokens[logout], T1);
  });
});

describe("cookieValue", () => {
  it("finds one cookie among several and decodes it", () => {
    assert.equal(cookieValue("a=1; sr_csrf=abc%2Ddef; b=2", "sr_csrf"), "abc-def");
  });

  it("matches the whole name only", () => {
    assert.equal(cookieValue("xsr_csrf=1; sr_csrf_old=2", "sr_csrf"), null);
  });

  it("returns null when the cookie is missing or empty", () => {
    assert.equal(cookieValue("", "sr_csrf"), null);
    assert.equal(cookieValue("sr_csrf=", "sr_csrf"), null);
  });
});

describe("isCsrfRefusal", () => {
  it("recognises the API's CSRF refusal by its problem type", async () => {
    const res = new Response(JSON.stringify({ type: CSRF_PROBLEM, status: 403 }), { status: 403 });
    assert.equal(await isCsrfRefusal(res), true);
    // Only a copy was read, so the caller can still read the answer.
    assert.equal((await res.json()).type, CSRF_PROBLEM);
  });

  it("is false for any other answer", async () => {
    const other = JSON.stringify({ message: "You do not have access to this resource" });
    assert.equal(await isCsrfRefusal(new Response(other, { status: 403 })), false);
    assert.equal(await isCsrfRefusal(new Response("Forbidden", { status: 403 })), false);
    assert.equal(
      await isCsrfRefusal(new Response(JSON.stringify({ type: CSRF_PROBLEM }), { status: 200 })),
      false,
    );
  });
});
