import { apiOrigin } from "./api-origin";
import type {
  CalendarSessionView,
  SessionView,
  WorkshopCard,
  WorkshopDetail,
} from "./catalogue-types";

/**
 * Server-side reads of the public catalogue. Pages render on request; the
 * answers are kept in Next's data cache for a minute, so a sleeping free API
 * costs one visitor a wait and everyone after them a cached page (ADR-034).
 * Seat counts on screen are refreshed live in the browser (SessionList).
 */
const REVALIDATE_SECONDS = 60;

/**
 * Render's free API takes about a minute to wake, and holds the request open
 * meanwhile. A visitor should see "try again" long before that.
 */
const TIMEOUT_MS = 8_000;

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "not-found" | "unavailable" };

async function get<T>(path: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${apiOrigin()}/api/v1${path}`, {
      next: { revalidate: REVALIDATE_SECONDS, tags: ["catalogue"] },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (res.status === 404) return { ok: false, reason: "not-found" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

function map<T, U>(result: ApiResult<T>, pick: (data: T) => U): ApiResult<U> {
  return result.ok ? { ok: true, data: pick(result.data) } : result;
}

export async function getWorkshops(): Promise<ApiResult<WorkshopCard[]>> {
  return map(
    await get<{ workshops: WorkshopCard[] }>("/workshops"),
    (d) => d.workshops,
  );
}

export async function getWorkshop(
  slug: string,
): Promise<ApiResult<WorkshopDetail>> {
  return map(
    await get<{ workshop: WorkshopDetail }>(
      `/workshops/${encodeURIComponent(slug)}`,
    ),
    (d) => d.workshop,
  );
}

export async function getWorkshopSessions(
  slug: string,
): Promise<ApiResult<SessionView[]>> {
  return map(
    await get<{ sessions: SessionView[] }>(
      `/workshops/${encodeURIComponent(slug)}/sessions`,
    ),
    (d) => d.sessions,
  );
}

export async function getSessions(
  from: string,
  to: string,
): Promise<ApiResult<CalendarSessionView[]>> {
  const query = new URLSearchParams({ from, to });
  return map(
    await get<{ sessions: CalendarSessionView[] }>(`/sessions?${query}`),
    (d) => d.sessions,
  );
}
