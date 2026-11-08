/**
 * The browser's side of sign-in. The API keeps the session in two httpOnly
 * cookies on this site's own address (the /api/v1 rewrite), so nothing here
 * ever sees a token: it only decides when to ask the API to refresh them.
 *
 * The rules come from SPEC § 10 item 17:
 * - One refresh at a time. Every request that gets a 401 while a refresh is in
 *   flight waits for that same refresh, so one tab never spends its refresh
 *   cookie twice.
 * - A refresh that fails is not yet proof of being signed out. Another tab may
 *   have won the race and already stored new cookies, or the winning answer
 *   was lost while the API woke from sleep. The request is retried once, with
 *   whatever cookies the browser now holds, before it counts as signed out.
 * - Sign-out waits for a refresh in flight, so that refresh cannot set a new
 *   session after the sign-out has cleared the old one.
 *
 * Every write also carries the CSRF token (`withCsrf` below), so the refresh
 * and sign-out calls are protected like any other.
 *
 * Kept free of React and Next imports so `session.test.mjs` can drive it with
 * a fake fetch.
 */

export type Role = "CUSTOMER" | "ADMIN";

export type User = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  role: Role;
  marketingConsent: boolean;
  createdAt: string;
};

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const API = "/api/v1";

/** Routes that answer for themselves: a 401 from these is the answer. */
const NO_REFRESH = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/logout",
  "/auth/forgot-password",
  "/auth/reset-password",
]);

/**
 * Remembered in localStorage so pages can skip the session check for visitors
 * who never signed in: for them it would be three requests to a sleeping API
 * on every page view, all answered 401. It holds the first name, so the header
 * and home page can greet someone as soon as the page loads instead of after
 * the API answers. Only a hint, never trusted; the API decides.
 */
export const SIGNED_IN_HINT = "sr_signed_in_as";

/** Fired on window whenever this tab signs in or out. */
export const SESSION_CHANGED = "sr-session-changed";

/** The first name of whoever is signed in on this browser, or null for a visitor. */
type Hint = {
  get(): string | null;
  set(firstName: string | null): void;
};

const browserHint: Hint = {
  get: () => {
    try {
      return globalThis.localStorage?.getItem(SIGNED_IN_HINT) ?? null;
    } catch {
      return null;
    }
  },
  set: (firstName) => {
    try {
      if (firstName === null) globalThis.localStorage?.removeItem(SIGNED_IN_HINT);
      else globalThis.localStorage?.setItem(SIGNED_IN_HINT, firstName);
    } catch {
      // Private browsing can refuse storage; the hint is only an optimisation.
    }
    // The header outlives page changes, so it listens rather than re-checking.
    globalThis.dispatchEvent?.(new Event(SESSION_CHANGED));
  },
};

/** The hinted first name, or null. An empty string means signed in, name unknown. */
export function hintedFirstName(): string | null {
  return browserHint.get();
}

/** The first name in a sign-in or register answer, read without using up the body. */
async function firstNameOf(res: Response): Promise<string> {
  const body = (await res.clone().json().catch(() => null)) as { user?: Partial<User> } | null;
  return body?.user?.firstName ?? "";
}

export function createSessionClient(fetchImpl: Fetch, hint: Hint = browserHint) {
  let refreshing: Promise<boolean> | null = null;

  function send(path: string, init: RequestInit = {}) {
    return fetchImpl(`${API}${path}`, {
      ...init,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  }

  function refresh(): Promise<boolean> {
    refreshing ??= send("/auth/refresh", { method: "POST" })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  /** Any API call that needs the visitor to be signed in. */
  async function request(path: string, init: RequestInit = {}): Promise<Response> {
    const first = await send(path, init);
    if (first.status !== 401 || NO_REFRESH.has(path)) return first;
    await refresh();
    // Retried whether or not the refresh succeeded: see item 17 above. A 401
    // means the first attempt did nothing, so a retry cannot repeat a write.
    return send(path, init);
  }

  /** The signed-in user, or null. Throws only if the API cannot be reached. */
  async function me(): Promise<User | null> {
    const res = await request("/auth/me");
    if (res.ok) {
      const { user } = (await res.json()) as { user: User };
      hint.set(user.firstName);
      return user;
    }
    if (res.status === 401 || res.status === 404) {
      hint.set(null);
      return null;
    }
    throw new Error(`Session check failed with ${res.status}`);
  }

  /** As `me`, but skips the API entirely for a visitor who never signed in. */
  function meIfHinted(): Promise<User | null> {
    return hint.get() !== null ? me() : Promise.resolve(null);
  }

  async function post(path: string, body: unknown): Promise<Response> {
    const res = await request(path, { method: "POST", body: JSON.stringify(body) });
    if (res.ok && (path === "/auth/login" || path === "/auth/register")) {
      hint.set(await firstNameOf(res));
    }
    // The API ends every session of the account when its password changes.
    if (res.ok && path === "/auth/reset-password") hint.set(null);
    return res;
  }

  async function signOut(): Promise<void> {
    if (refreshing) await refreshing;
    hint.set(null);
    await send("/auth/logout", { method: "POST" }).catch(() => undefined);
  }

  return { request, me, meIfHinted, post, signOut };
}

/**
 * The CSRF token (SPEC § 3, ADR-003). The API keeps it in a cookie that pages
 * can read, and refuses any write whose x-csrf-token header does not repeat
 * it (backend/src/common/csrf.ts). Another site can make the browser send the
 * cookie, but cannot read it, so it cannot copy it into the header.
 */
export const CSRF_COOKIE = "sr_csrf";
export const CSRF_HEADER = "x-csrf-token";

/** The problem type of the API's refusal, which sets it apart from any other 403. */
export const CSRF_PROBLEM = "tag:studio-rags.vercel.app,2026:csrf-token";

/** Methods that only read. The API asks no token of these. */
const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/** One cookie's value from a `document.cookie` string, or null. */
export function cookieValue(cookies: string, name: string): string | null {
  for (const pair of cookies.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1 || pair.slice(0, eq).trim() !== name) continue;
    const raw = pair.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw) || null;
    } catch {
      return raw || null;
    }
  }
  return null;
}

function browserCsrfCookie(): string | null {
  return cookieValue(globalThis.document?.cookie ?? "", CSRF_COOKIE);
}

/** True when the API refused a write because its CSRF token was missing or stale. */
export async function isCsrfRefusal(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  const body = (await res.clone().json().catch(() => null)) as { type?: unknown } | null;
  return body?.type === CSRF_PROBLEM;
}

/**
 * Wraps fetch so every write to the API carries the CSRF token.
 * - The token is read from the cookie as each request leaves, so one that
 *   sign-in or another tab has just replaced is picked up at once.
 * - With no cookie yet (a first visit, or it expired), it asks the API for
 *   one first. Writes that start together share that one request.
 * - If the API still refuses the token, it asks again and sends the request
 *   once more. A refusal means the API did nothing, so the retry cannot
 *   repeat a write; bodies here are strings, so it can send the same one.
 *   A second refusal goes back to the caller.
 */
export function withCsrf(
  fetchImpl: Fetch,
  readCookie: () => string | null = browserCsrfCookie,
): Fetch {
  let asking: Promise<string | null> | null = null;

  function askForToken(): Promise<string | null> {
    asking ??= fetchImpl(`${API}/auth/csrf`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    })
      .then(async (res) => {
        if (!res.ok) return readCookie();
        const body = (await res.json().catch(() => null)) as { csrfToken?: unknown } | null;
        // The API answers with the token its cookie now holds.
        return typeof body?.csrfToken === "string" ? body.csrfToken : readCookie();
      })
      .finally(() => {
        asking = null;
      });
    return asking;
  }

  function send(input: string, init: RequestInit, token: string | null) {
    const headers = new Headers(init.headers);
    if (token) headers.set(CSRF_HEADER, token);
    return fetchImpl(input, { ...init, headers });
  }

  return async (input, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    // Reads need no token, and only our own API is ever shown it.
    if (READS.has(method) || !input.startsWith(`${API}/`)) return fetchImpl(input, init);

    const first = await send(input, init, readCookie() ?? (await askForToken()));
    if (!(await isCsrfRefusal(first))) return first;
    return send(input, init, await askForToken());
  };
}

/** fetch for calling the API from the browser: every write carries the CSRF token. */
export const apiFetch = withCsrf((input, init) => fetch(input, init));

export const session = createSessionClient(apiFetch);

/** The message(s) a Nest error carries: one string, or a list from validation. */
export async function errorMessages(res: Response): Promise<string[]> {
  const json = (await res.json().catch(() => null)) as { message?: unknown } | null;
  const message = json?.message;
  if (Array.isArray(message)) return message.filter((m): m is string => typeof m === "string");
  return typeof message === "string" ? [message] : [];
}

/**
 * Where to go after signing in. Only a path on this site: a full URL, or a
 * "//host" that browsers treat as one, would make the sign-in page an open
 * redirect for phishing links.
 */
export function safeNext(next: string | null | undefined, fallback = "/account"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
