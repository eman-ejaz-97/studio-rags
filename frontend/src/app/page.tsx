import Link from "next/link";
import { connection } from "next/server";
import { apiOrigin } from "@/lib/api-origin";

/**
 * Staging status page. A placeholder until the real home page is built: it
 * proves the whole chain (Vercel, Render, Neon database, Neon storage) answers.
 */

type DependencyState = "up" | "down" | "not-configured";

interface Readiness {
  database: DependencyState;
  storage: DependencyState;
  checkedAt: string | null;
}

/**
 * Render takes about a minute to wake a sleeping free service, and holds the
 * request open meanwhile. Eight seconds is long enough for a warm API that is
 * waking Neon, short enough not to leave a visitor staring at a blank page.
 */
const HEALTH_TIMEOUT_MS = 8_000;

function isDependencyState(value: unknown): value is DependencyState {
  return value === "up" || value === "down" || value === "not-configured";
}

/**
 * GET /api/v1/health. Called server to server, so it skips the /api/v1
 * rewrite. Returns null when the API does not answer in time or answers with
 * something that is not a readiness report, such as Render's own error page.
 */
async function fetchReadiness(): Promise<Readiness | null> {
  try {
    const response = await fetch(`${apiOrigin()}/api/v1/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    // No response.ok check: a 503 still carries the full report, and a
    // database that is down is exactly what this page should show.
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) return null;

    const { database, storage, timestamp } = body as Record<string, unknown>;
    if (!isDependencyState(database) || !isDependencyState(storage)) {
      return null;
    }
    return {
      database,
      storage,
      checkedAt: typeof timestamp === "string" ? timestamp : null,
    };
  } catch {
    return null;
  }
}

// Words carry the meaning; the symbol and colour only repeat it. Each colour
// passes AA (4.5:1 or better) on the white card.
const STATE_DISPLAY: Record<
  DependencyState,
  { label: string; symbol: string; className: string }
> = {
  up: { label: "Up", symbol: "✓", className: "text-[#1e6b3f]" },
  down: { label: "Down", symbol: "✕", className: "text-[#a3262a]" },
  "not-configured": { label: "Not set up", symbol: "–", className: "text-ink" },
};

function StatusRow({
  name,
  state,
}: {
  name: string;
  state: DependencyState;
}) {
  const { label, symbol, className } = STATE_DISPLAY[state];
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <dt>{name}</dt>
      <dd className={`font-semibold ${className}`}>
        <span aria-hidden="true" className="mr-2">
          {symbol}
        </span>
        {label}
      </dd>
    </div>
  );
}

const adelaideTime = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Adelaide",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

export default async function Home() {
  // Render on every request, never at build time: the status is only worth
  // anything live. Outside the try/catch on purpose, because Next signals
  // "this page is dynamic" by throwing, and a catch would swallow it.
  await connection();
  const readiness = await fetchReadiness();

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-12 sm:py-16">
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-5xl font-black text-plum">
          Studio Rags
        </h1>
        <p className="text-lg">
          The new website is being built. This is the test site.
        </p>
      </header>

      <section
        aria-labelledby="status-heading"
        className="rounded-2xl border border-plum/15 bg-white p-6 shadow-sm"
      >
        <h2
          id="status-heading"
          className="font-display text-2xl font-semibold text-plum"
        >
          Test server status
        </h2>

        {readiness ? (
          <>
            <dl className="mt-4 divide-y divide-plum/15">
              <StatusRow name="API" state="up" />
              <StatusRow name="Database" state={readiness.database} />
              <StatusRow name="File storage" state={readiness.storage} />
            </dl>
            {readiness.checkedAt && (
              <p className="mt-4 text-base">
                Checked at{" "}
                <time dateTime={readiness.checkedAt}>
                  {adelaideTime.format(new Date(readiness.checkedAt))}
                </time>
                , Adelaide time.
              </p>
            )}
          </>
        ) : (
          <p className="mt-4">
            The test server is waking up — it sleeps after 15 minutes without
            visitors. Refresh in about a minute.
          </p>
        )}

        {/* prefetch off: a prefetch would call the API, and every health
            check wakes the database. */}
        <Link
          href="/"
          prefetch={false}
          className="mt-6 inline-flex min-h-12 items-center rounded-full bg-purple px-6 font-semibold text-white underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-plum"
        >
          Check again
        </Link>
      </section>
    </main>
  );
}
