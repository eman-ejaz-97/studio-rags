import type { Metadata } from "next";
import Link from "next/link";
import { ApiUnavailable } from "@/components/api-unavailable";
import { pageWrap } from "@/components/ui";
import {
  type MonthKey,
  currentMonth,
  dayKey,
  formatLongDay,
  formatMonth,
  formatTime,
  monthRange,
  parseMonth,
  shiftMonth,
} from "@/lib/adelaide";
import { getSessions } from "@/lib/catalogue";
import type { CalendarSessionView } from "@/lib/catalogue-types";
import { formatPrice, formatSeatsLeft } from "@/lib/format";

export const metadata: Metadata = {
  title: "Calendar",
  description: "Every Studio Rags class date, month by month.",
};

/** How far ahead the calendar lets you page: the API refuses wider ranges. */
const MONTHS_AHEAD = 6;

/**
 * A list by day rather than a month grid: it reads in order on a phone, a
 * screen reader announces it as headings and lists, and nothing hides in a
 * cell too small to tap.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: requested } = await searchParams;
  const thisMonth = currentMonth();
  const lastMonth = shiftMonth(thisMonth, MONTHS_AHEAD);
  const month = clamp(parseMonth(requested) ?? thisMonth, thisMonth, lastMonth);

  const { from, to } = monthRange(month);
  const result = await getSessions(from, to);

  return (
    <div className={`${pageWrap} py-12`}>
      <h1 className="font-display text-[clamp(2.2rem,5vw,3.2rem)] leading-tight font-black text-plum">
        Calendar
      </h1>

      <nav
        aria-label="Choose a month"
        className="mt-6 grid grid-cols-2 items-center gap-2 rounded-[var(--radius-card)] border-2 border-line bg-card p-3 sm:grid-cols-[1fr_auto_1fr]"
      >
        <h2 className="col-span-2 text-center font-display text-[1.6rem] font-semibold text-plum sm:order-2 sm:col-span-1">
          {formatMonth(month)}
        </h2>
        <span className="justify-self-start sm:order-1">
          <MonthLink month={shiftMonth(month, -1)} disabled={month === thisMonth}>
            ← Previous
            <span className="sr-only">
              {" "}
              month, {formatMonth(shiftMonth(month, -1))}
            </span>
          </MonthLink>
        </span>
        <span className="justify-self-end sm:order-3">
          <MonthLink month={shiftMonth(month, 1)} disabled={month === lastMonth}>
            Next
            <span className="sr-only">
              {" "}
              month, {formatMonth(shiftMonth(month, 1))}
            </span>{" "}
            →
          </MonthLink>
        </span>
      </nav>

      <div className="mt-8">
        {!result.ok ? (
          <ApiUnavailable what="the calendar" />
        ) : result.data.length === 0 ? (
          <p className="text-muted">
            No classes are on sale for {formatMonth(month)} yet.
          </p>
        ) : (
          <ol className="flex flex-col gap-8">
            {byDay(result.data).map(([day, sessions]) => (
              <li key={day}>
                <h3 className="font-display text-[1.3rem] font-semibold text-plum">
                  <time dateTime={day}>{formatLongDay(sessions[0].startsAt)}</time>
                </h3>
                <ul className="mt-3 flex flex-col gap-3">
                  {sessions.map((s) => (
                    <li key={s.id}>
                      <CalendarEntry session={s} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function CalendarEntry({ session: s }: { session: CalendarSessionView }) {
  return (
    <Link
      href={`/classes/${s.workshop.slug}`}
      className="flex flex-col gap-1 rounded-[var(--radius-card)] border-2 border-line bg-card p-4 hover:border-purple sm:flex-row sm:items-center sm:justify-between"
    >
      <span>
        <span className="block font-semibold text-plum">{s.workshop.title}</span>
        <span className="text-muted">
          {formatTime(s.startsAt)} ·{" "}
          {s.workshop.deliveryMode === "ONLINE" ? "Live on Zoom" : "In the studio"} ·{" "}
          {formatPrice(s.priceCents)}
        </span>
      </span>
      <span
        className={`self-start rounded-full px-3 py-1 font-semibold sm:self-auto ${
          s.isFull ? "bg-lilac text-muted" : "bg-sand text-sand-ink"
        }`}
      >
        {formatSeatsLeft(s.seatsLeft)}
      </span>
    </Link>
  );
}

function MonthLink({
  month,
  disabled,
  children,
}: {
  month: MonthKey;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className =
    "inline-flex min-h-11 items-center rounded-full px-4 font-semibold";
  if (disabled) {
    // Not a link at all, so it is neither focusable nor announced as one.
    return (
      <span className={`${className} text-subtle`}>
        <span>{children}</span>
      </span>
    );
  }
  // The inner span keeps the spaces around the hidden text: a flex container
  // drops whitespace-only text between its children.
  return (
    <Link href={`/calendar?month=${month}`} className={`${className} text-purple hover:bg-lilac`}>
      <span>{children}</span>
    </Link>
  );
}

function byDay(sessions: CalendarSessionView[]) {
  const days = new Map<string, CalendarSessionView[]>();
  for (const s of sessions) {
    const key = dayKey(s.startsAt);
    days.set(key, [...(days.get(key) ?? []), s]);
  }
  return [...days.entries()];
}

function clamp(month: MonthKey, min: MonthKey, max: MonthKey): MonthKey {
  if (month < min) return min;
  if (month > max) return max;
  return month;
}
