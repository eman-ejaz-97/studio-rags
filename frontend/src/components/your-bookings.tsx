"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatLongDay, formatTime } from "@/lib/adelaide";
import { bookingPath, groupBookings, isLiveHold, statusLabel } from "@/lib/booking";
import type { BookingPage, BookingView } from "@/lib/booking-types";
import { formatPlaces } from "@/lib/format";
import { session } from "@/lib/session";
import { ApiUnavailable } from "./api-unavailable";
import { DateTile, Icon, Loading } from "./booking-parts";
import { buttonOutline, buttonPrimary, textLink } from "./ui";

/** Enough for anyone's upcoming classes on the first page; older ones on request. */
const PAGE_SIZE = 50;

type State =
  | { state: "loading" }
  | { state: "unavailable" }
  | { state: "ready"; bookings: BookingView[]; nextCursor: string | null };

async function fetchPage(cursor?: string): Promise<BookingPage> {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) query.set("cursor", cursor);
  const res = await session.request(`/bookings?${query}`);
  if (!res.ok) throw new Error(`Bookings answered ${res.status}`);
  return (await res.json()) as BookingPage;
}

/**
 * The account page's list: classes coming up first, soonest at the top, then
 * past and cancelled ones. A hold that is still running says so and offers
 * to finish it.
 */
export function YourBookings() {
  const [s, setS] = useState<State>({ state: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    fetchPage()
      .then((page) => {
        if (live) setS({ state: "ready", bookings: page.bookings, nextCursor: page.nextCursor });
      })
      .catch(() => {
        if (live) setS({ state: "unavailable" });
      });
    return () => {
      live = false;
    };
  }, []);

  async function showMore(cursor: string) {
    setLoadingMore(true);
    try {
      const page = await fetchPage(cursor);
      setS((current) =>
        current.state === "ready"
          ? {
              state: "ready",
              bookings: [...current.bookings, ...page.bookings],
              nextCursor: page.nextCursor,
            }
          : current,
      );
    } catch {
      // The button stays, so trying again is one tap.
    }
    setLoadingMore(false);
  }

  return (
    <section
      id="bookings"
      aria-labelledby="bookings-heading"
      className="flex max-w-3xl scroll-mt-6 flex-col gap-5"
    >
      <h2 id="bookings-heading" className="font-display text-[1.8rem] font-semibold text-plum">
        Your bookings
      </h2>
      {s.state === "loading" && <Loading>Loading your bookings…</Loading>}
      {s.state === "unavailable" && <ApiUnavailable what="your bookings" />}
      {s.state === "ready" && (
        <Lists
          {...groupBookings(s.bookings, now)}
          now={now}
          more={
            s.nextCursor && (
              <button
                type="button"
                className={`${buttonOutline} self-start`}
                disabled={loadingMore}
                aria-disabled={loadingMore}
                onClick={() => showMore(s.nextCursor!)}
              >
                {loadingMore ? "Loading…" : "Show older bookings"}
              </button>
            )
          }
        />
      )}
    </section>
  );
}

function Lists({
  upcoming,
  past,
  now,
  more,
}: {
  upcoming: BookingView[];
  past: BookingView[];
  now: number;
  more: React.ReactNode;
}) {
  if (upcoming.length === 0 && past.length === 0 && !more) {
    return (
      <div className="rounded-[var(--radius-card)] border-2 border-line bg-card p-6">
        <p className="text-body">
          You have no bookings yet. When you book a class, it will appear here with its date and
          your reference.
        </p>
        <Link href="/classes" className={`${textLink} mt-4 inline-flex min-h-11 items-center`}>
          Browse the classes
        </Link>
      </div>
    );
  }
  return (
    <>
      <div className="flex flex-col gap-3">
        <h3 className="text-[1.15rem] font-semibold text-plum">Coming up</h3>
        {upcoming.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {upcoming.map((b) => (
              <BookingRow key={b.reference} booking={b} now={now} />
            ))}
          </ul>
        ) : (
          <p className="text-body">
            Nothing booked at the moment.{" "}
            <Link href="/classes" className={textLink}>
              Browse the classes
            </Link>
          </p>
        )}
      </div>
      {past.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-[1.15rem] font-semibold text-plum">Past and cancelled</h3>
          <ul className="flex flex-col gap-3">
            {past.map((b) => (
              <BookingRow key={b.reference} booking={b} now={now} />
            ))}
          </ul>
        </div>
      )}
      {more}
    </>
  );
}

const CHIP: Record<string, { tone: string; icon?: "check" | "clock" }> = {
  Booked: { tone: "bg-ok-bg text-ok-ink", icon: "check" },
  "Not booked yet": { tone: "bg-sand text-sand-ink", icon: "clock" },
};

function BookingRow({ booking, now }: { booking: BookingView; now: number }) {
  const s = booking.session;
  const kids = s.workshop.productType === "KIDS";
  const hold = isLiveHold(booking, now);
  const label = statusLabel(booking, now);
  const chip = label ? (CHIP[label] ?? { tone: "bg-lilac text-muted" }) : null;
  const when = `${formatLongDay(s.startsAt)}, ${formatTime(s.startsAt)}`;

  return (
    <li
      className={`relative flex flex-col gap-4 rounded-[var(--radius-card)] border-2 border-line bg-card p-5 sm:flex-row sm:items-center sm:justify-between ${
        hold ? "" : "transition-shadow hover:shadow-md has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-purple"
      }`}
    >
      <div className="flex gap-4">
        <DateTile iso={s.startsAt} />
        <div className="flex min-w-0 flex-col items-start gap-1">
          <p className="font-display text-[1.2rem] leading-tight font-semibold text-plum">
            {hold ? (
              s.workshop.title
            ) : (
              // The whole card is this one link, named by the class.
              <Link
                href={bookingPath(booking.reference)}
                className="after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none"
              >
                {s.workshop.title}
              </Link>
            )}
          </p>
          <p className="font-semibold text-ink">
            <time dateTime={s.startsAt}>
              {formatLongDay(s.startsAt)},{" "}
              <span className="whitespace-nowrap">{formatTime(s.startsAt)}</span>
            </time>
          </p>
          <p className="text-muted">
            {formatPlaces(booking.seats, kids)} ·{" "}
            <span className="whitespace-nowrap">{booking.reference}</span>
          </p>
          {chip && (
            <span
              className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 font-semibold ${chip.tone}`}
            >
              {chip.icon && <Icon name={chip.icon} className="size-4" />}
              {label}
            </span>
          )}
        </div>
      </div>
      {hold ? (
        <Link href={bookingPath(booking.reference)} className={`${buttonPrimary} w-full sm:w-auto`}>
          Finish booking
          <span className="sr-only">: {s.workshop.title}, {when}</span>
        </Link>
      ) : (
        <Icon name="arrow" className="hidden size-6 text-purple sm:block" />
      )}
    </li>
  );
}
