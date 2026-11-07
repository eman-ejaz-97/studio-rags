/**
 * Every date on the site is shown in Adelaide time, whatever the visitor's own
 * time zone: the studio is in Sefton Park, and an online class at 6:30 pm is
 * 6:30 pm in Adelaide. The API stores and returns UTC.
 */
export const TIME_ZONE = "Australia/Adelaide";

const dayFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

const longDayFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const timeFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const monthFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

const ymdFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Assembled from parts rather than taken from format(): punctuation and spaces
 * differ between ICU versions (Node prints "Sat, 14 Nov"), and the server and
 * the browser must print the same text or React reports a hydration mismatch.
 */
function partsOf(format: Intl.DateTimeFormat, iso: string) {
  return Object.fromEntries(
    format.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  ) as Partial<Record<Intl.DateTimeFormatPartTypes, string>>;
}

/** "Sat 14 Nov" */
export function formatDay(iso: string): string {
  const p = partsOf(dayFormat, iso);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "Saturday 14 November" */
export function formatLongDay(iso: string): string {
  const p = partsOf(longDayFormat, iso);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "10:00 am" */
export function formatTime(iso: string): string {
  const p = partsOf(timeFormat, iso);
  return `${p.hour}:${p.minute} ${(p.dayPeriod ?? "").toLowerCase()}`.trim();
}

/** "2026-11-14": the Adelaide calendar day, for grouping. */
export function dayKey(iso: string): string {
  return ymdFormat.format(new Date(iso));
}

/** A month as "YYYY-MM". */
export type MonthKey = `${number}-${number}`;

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function parseMonth(value: string | undefined): MonthKey | null {
  return value && MONTH_KEY.test(value) ? (value as MonthKey) : null;
}

/** The current month in Adelaide. */
export function currentMonth(now = new Date()): MonthKey {
  return dayKey(now.toISOString()).slice(0, 7) as MonthKey;
}

export function shiftMonth(month: MonthKey, by: number): MonthKey {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` as MonthKey;
}

/** "November 2026" */
export function formatMonth(month: MonthKey): string {
  const [y, m] = month.split("-").map(Number);
  const p = partsOf(monthFormat, new Date(Date.UTC(y, m - 1, 1)).toISOString());
  return `${p.month} ${p.year}`;
}

/** Adelaide's offset from UTC in minutes at `at`: 570 in winter, 630 in summer. */
function offsetMinutes(at: Date): number {
  const name = new Intl.DateTimeFormat("en-AU", {
    timeZone: TIME_ZONE,
    timeZoneName: "longOffset",
  })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? "");
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -minutes : minutes;
}

/** Midnight at the start of the 1st, in Adelaide, as a UTC instant. */
function startOfMonth(month: MonthKey): Date {
  const [y, m] = month.split("-").map(Number);
  const asIfUtc = Date.UTC(y, m - 1, 1);
  return new Date(asIfUtc - offsetMinutes(new Date(asIfUtc)) * 60_000);
}

/** [first moment, first moment of the next month), both in Adelaide. */
export function monthRange(month: MonthKey): { from: string; to: string } {
  return {
    from: startOfMonth(month).toISOString(),
    to: startOfMonth(shiftMonth(month, 1)).toISOString(),
  };
}
