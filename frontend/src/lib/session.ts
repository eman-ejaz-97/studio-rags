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
 * on every page view, all answered 401. Only a hint, never trusted; the API
 * decides.
 */
export const SIGNED_IN_HINT = "sr_signed_in";

/** Fired on window whenever this tab signs in or out. */
export const SESSION_CHANGED = "sr-session-changed";

type Hint = {
  get(): boolean;
  set(on: boolean): void;
};

const browserHint: Hint = {
  get: () => {
    try {
      return globalThis.localStorage?.getItem(SIGNED_IN_HINT) === "1";
    } catch {
      return false;
    }
  },
  set: (on) => {
    try {
      if (on) globalThis.localStorage?.setItem(SIGNED_IN_HINT, "1");
      else globalThis.localStorage?.removeItem(SIGNED_IN_HINT);
    } catch {
      // Private browsing can refuse storage; the hint is only an optimisation.
    }
    // The header outlives page changes, so it listens rather than re-checking.
    globalThis.dispatchEvent?.(new Event(SESSION_CHANGED));
  },
};

export function hintedSignedIn(): boolean {
  return browserHint.get();
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
      hint.set(true);
      return user;
    }
    if (res.status === 401 || res.status === 404) {
      hint.set(false);
      return null;
    }
    throw new Error(`Session check failed with ${res.status}`);
  }

  /** As `me`, but skips the API entirely for a visitor who never signed in. */
  function meIfHinted(): Promise<User | null> {
    return hint.get() ? me() : Promise.resolve(null);
  }

  async function post(path: string, body: unknown): Promise<Response> {
    const res = await request(path, { method: "POST", body: JSON.stringify(body) });
    if (res.ok && (path === "/auth/login" || path === "/auth/register")) hint.set(true);
    // The API ends every session of the account when its password changes.
    if (res.ok && path === "/auth/reset-password") hint.set(false);
    return res;
  }

  async function signOut(): Promise<void> {
    if (refreshing) await refreshing;
    hint.set(false);
    await send("/auth/logout", { method: "POST" }).catch(() => undefined);
  }

  return { request, me, meIfHinted, post, signOut };
}

export const session = createSessionClient((input, init) => fetch(input, init));

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
