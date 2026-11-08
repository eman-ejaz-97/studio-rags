/**
 * Dates and money in the words the website uses (frontend/src/lib/adelaide.ts
 * and format.ts), so an email never disagrees with the page it came from.
 * Every time is Adelaide time, wherever the reader is: the studio is in
 * Sefton Park, and an online class at 6:30 pm is 6:30 pm in Adelaide.
 */
export const TIME_ZONE = 'Australia/Adelaide';

const longDay = new Intl.DateTimeFormat('en-AU', {
  timeZone: TIME_ZONE,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const shortDay = new Intl.DateTimeFormat('en-AU', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

const time = new Intl.DateTimeFormat('en-AU', {
  timeZone: TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

/**
 * Assembled from parts, as on the website: punctuation and spacing in
 * format() differ between ICU versions.
 */
function partsOf(format: Intl.DateTimeFormat, at: Date) {
  return Object.fromEntries(
    format.formatToParts(at).map((p) => [p.type, p.value]),
  ) as Partial<Record<Intl.DateTimeFormatPartTypes, string>>;
}

/** "Saturday 16 January 2027" */
export function formatLongDay(at: Date): string {
  const p = partsOf(longDay, at);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** "Sat 16 Jan" */
export function formatShortDay(at: Date): string {
  const p = partsOf(shortDay, at);
  return `${p.weekday} ${p.day} ${p.month}`;
}

/** "10:00 am" */
export function formatTime(at: Date): string {
  const p = partsOf(time, at);
  return `${p.hour}:${p.minute} ${(p.dayPeriod ?? '').toLowerCase()}`.trim();
}

/** Money arrives as integer cents (AUD). "$82", or "$82.50" when there are cents. */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
