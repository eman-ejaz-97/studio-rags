/**
 * The pieces every booking screen shares, so a date, a class and the main
 * action look the same from the class page to "You're booked". No hooks here:
 * server pages and client components both use them.
 */

import Link from "next/link";
import { dayParts, formatLongDay, formatTimeRange } from "@/lib/adelaide";
import type { DeliveryMode } from "@/lib/catalogue-types";
import { buttonOutline, buttonPrimary } from "./ui";

// ─── Icons ──────────────────────────────────────────────────────────────────

const PATHS = {
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-5.8-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z" />
      <circle cx="12" cy="10.5" r="2.3" />
    </>
  ),
  video: (
    <>
      <rect x="2.5" y="6" width="13.5" height="12" rx="2.5" />
      <path d="m16 10.5 5.5-3v9l-5.5-3" />
    </>
  ),
  check: <path d="M5 12.5 10 17.5 19 7" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.75v.01" />
    </>
  ),
  minus: <path d="M6 12h12" />,
  plus: <path d="M12 6v12M6 12h12" />,
  arrow: <path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5" />,
  mail: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="m3.5 7.5 8.5 6 8.5-6" />
    </>
  ),
  message: <path d="M4.5 5.5h15v10.5h-10L5 20v-4H4.5z" />,
};

export type IconName = keyof typeof PATHS;

/** Decorative: the words beside each icon carry the meaning. */
export function Icon({ name, className = "size-5" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}

// ─── Dates and places ───────────────────────────────────────────────────────

/** "Studio Rags, Sefton Park SA", or Zoom for an online class. */
export function placeOf(deliveryMode: DeliveryMode, location: string | null): string {
  if (deliveryMode === "ONLINE") return "Live on Zoom, from home";
  return location ?? "Studio Rags, Sefton Park";
}

/**
 * A page from a desk calendar: weekday, day, month. The full date is always
 * written out beside it, so the tile itself is hidden from screen readers.
 * Gold only on the purple ticket, where gold is allowed (CLAUDE.md).
 */
export function DateTile({ iso, tone = "sand" }: { iso: string; tone?: "sand" | "gold" }) {
  const { weekday, day, month } = dayParts(iso);
  const colours = tone === "gold" ? "bg-gold text-on-gold" : "bg-sand text-sand-ink";
  return (
    <div
      aria-hidden="true"
      className={`flex w-16 shrink-0 flex-col items-center self-start rounded-2xl py-2 leading-none ${colours}`}
    >
      <span className="text-base font-semibold uppercase">{weekday}</span>
      <span className="font-display text-[1.9rem] leading-[1.1] font-black">{day}</span>
      <span className="text-base font-semibold">{month}</span>
    </div>
  );
}

/**
 * The class and date being booked: the same card on the form, the hold and
 * the account page, so the customer always knows which date they are on.
 * `children` adds rows below, such as the places and the price.
 */
export function ClassSummary({
  title,
  startsAt,
  endsAt,
  deliveryMode,
  location,
  headingLevel = 2,
  children,
}: {
  title: string;
  startsAt: string;
  endsAt: string;
  deliveryMode: DeliveryMode;
  location: string | null;
  headingLevel?: 2 | 3;
  children?: React.ReactNode;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section className="rounded-[var(--radius-card)] border-2 border-line bg-card p-5 sm:p-6">
      <div className="flex gap-4">
        <DateTile iso={startsAt} />
        <div className="flex min-w-0 flex-col gap-1">
          <Heading className="font-display text-[1.35rem] leading-tight font-semibold text-plum">
            {title}
          </Heading>
          <p className="font-semibold text-ink">
            <time dateTime={startsAt}>{formatLongDay(startsAt)}</time>
          </p>
          <p className="flex items-center gap-2 text-muted">
            <Icon name="clock" className="size-[1.1rem] text-purple" />
            {formatTimeRange(startsAt, endsAt)}
          </p>
          <p className="flex items-center gap-2 text-muted">
            <Icon
              name={deliveryMode === "ONLINE" ? "video" : "pin"}
              className="size-[1.1rem] text-purple"
            />
            {placeOf(deliveryMode, location)}
          </p>
        </div>
      </div>
      {children && <div className="mt-5 border-t-2 border-line pt-4">{children}</div>}
    </section>
  );
}

/**
 * A label and value inside a summary card's <dl>. Short values sit at the
 * right; `block` puts a long one, such as notes, under its label.
 */
export function SummaryRow({
  label,
  block = false,
  children,
}: {
  label: string;
  block?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        block
          ? "flex flex-col gap-1 py-1.5"
          : "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1.5"
      }
    >
      <dt className="text-muted">{label}</dt>
      <dd className={block ? "text-ink" : "text-right font-semibold text-ink"}>{children}</dd>
    </div>
  );
}

// ─── The flow ───────────────────────────────────────────────────────────────

/**
 * Where the customer is in booking. Holding places is not booking them, and
 * the second step says so. When payments arrive, "Confirm" becomes "Pay".
 */
const STEPS = ["Your details", "Confirm"];

export function BookingSteps({ current }: { current: number }) {
  return (
    <ol aria-label="Booking steps" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {STEPS.map((label, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li
            key={label}
            aria-current={now ? "step" : undefined}
            className="flex items-center gap-2"
          >
            {i > 0 && <span aria-hidden="true" className="h-0.5 w-6 rounded-full bg-field-line" />}
            <span
              aria-hidden="true"
              className={`grid size-8 place-items-center rounded-full text-base font-bold ${
                now
                  ? "bg-purple text-white"
                  : done
                    ? "bg-lilac text-purple"
                    : "border-2 border-field-line text-muted"
              }`}
            >
              {done ? <Icon name="check" className="size-4" /> : i + 1}
            </span>
            <span className={now ? "font-semibold text-plum" : "text-muted"}>
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The total and the main action. On a phone it stays at the foot of the
 * screen, in thumb reach, until the end of the form scrolls into view, then
 * sits in its place (globals.css, .action-bar). Wider screens show it as a
 * card at the end of the form.
 */
export function ActionBar({
  total,
  breakdown,
  children,
}: {
  /** Already formatted: "$164". */
  total: string;
  breakdown: string;
  children: React.ReactNode;
}) {
  return (
    <div className="action-bar z-10 -mx-5 border-t-2 border-line bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-10px_24px_-12px_rgba(43,32,51,0.25)] sm:bottom-4 sm:mx-0 sm:rounded-[var(--radius-card)] sm:border-2 sm:p-5 sm:shadow-[0_10px_30px_-12px_rgba(43,32,51,0.3)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-baseline justify-between gap-3 sm:flex-col sm:items-start sm:gap-0">
          <span className="flex items-baseline gap-2">
            <span className="text-muted">Total</span>
            <span className="font-display text-[1.6rem] leading-none font-semibold text-plum">
              {total}
            </span>
          </span>
          <span className="text-subtle">{breakdown}</span>
        </p>
        {children}
      </div>
    </div>
  );
}

/** The primary action inside an ActionBar: full width on a phone. */
export const actionButton = `${buttonPrimary} w-full sm:w-auto sm:min-w-[13rem]`;

// ─── Signed out ─────────────────────────────────────────────────────────────

/** For a visitor: why to sign in, and a way back here afterwards (?next=). */
export function SignInToBook({
  next,
  title = "Sign in to book",
  lede,
}: {
  next: string;
  title?: string;
  lede?: string;
}) {
  const back = encodeURIComponent(next);
  return (
    <section
      aria-labelledby="sign-in-heading"
      className="rounded-[var(--radius-card)] border-2 border-line bg-card p-6 sm:p-8"
    >
      <h2 id="sign-in-heading" className="font-display text-2xl font-semibold text-plum">
        {title}
      </h2>
      <p className="mt-2 text-body">
        {lede ??
          "Your bookings are kept in your account, so you can always find the date and your reference."}{" "}
        You’ll come straight back here.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <Link href={`/sign-in?next=${back}`} className={buttonPrimary}>
          Sign in
        </Link>
        <Link href={`/register?next=${back}`} className={buttonOutline}>
          Create an account
        </Link>
      </div>
    </section>
  );
}

/** "Loading your booking…": a quiet line, announced once. */
export function Loading({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="py-6 text-muted">
      {children}
    </p>
  );
}

export const pageHeading =
  "font-display text-[clamp(2rem,6vw,2.8rem)] leading-tight font-black text-balance text-plum";
