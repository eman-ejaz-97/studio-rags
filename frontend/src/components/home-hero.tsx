"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatLongDay, formatTime } from "@/lib/adelaide";
import { bookingPath, nextBooked } from "@/lib/booking";
import type { BookingPage, BookingView } from "@/lib/booking-types";
import { session } from "@/lib/session";
import { useSignedInName } from "@/lib/use-signed-in-name";
import { DateTile, Icon, placeOf } from "./booking-parts";
import { buttonOutline, buttonPrimary } from "./ui";

const PROMISES = [
  "Materials included",
  "No experience needed",
  "Ages 7+ welcome",
];

const heading =
  "font-display text-[clamp(2.6rem,6vw,4.3rem)] leading-[1.02] font-black text-balance text-plum";
const lead = "mt-5 max-w-[40ch] text-[1.15rem] text-body";

/**
 * The words beside the hero photos. Visitors get the pitch; someone signed in
 * is welcomed back by name, shown their next booked class if they have one,
 * and sent straight to the classes. The server
 * renders the visitor's version, and the greeting replaces it once the page
 * has loaded, if this browser is signed in.
 */
export function HomeHero() {
  const name = useSignedInName();

  if (name === null) {
    return (
      <div>
        <h1 className={heading}>
          Make something
          <span className="block text-ochre">with your hands.</span>
        </h1>
        <p className={lead}>
          Batik, shibori, block printing and painting — for grown-ups, for
          kids, and for the two of you together.
        </p>
        <ul className="mt-6 flex flex-wrap gap-2" aria-label="Every class">
          {PROMISES.map((p) => (
            <li
              key={p}
              className="rounded-full bg-lilac px-4 py-2 text-base font-semibold text-purple"
            >
              {p}
            </li>
          ))}
        </ul>
        <Link href="/classes" className={`${buttonPrimary} mt-8`}>
          Find a class
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className={heading}>
        {name ? `Welcome back, ${name}.` : "Welcome back."}
        <span className="block text-ochre">What will you make next?</span>
      </h1>
      <NextClass />
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/classes" className={buttonPrimary}>
          Find your next class
        </Link>
        <Link href="/account" className={buttonOutline}>
          Your account
        </Link>
      </div>
    </div>
  );
}

/**
 * The soonest class this person has booked, or a nudge to book one. Asked of
 * the API only once the hero knows someone is signed in, so visitors never
 * cost a request.
 */
function NextClass() {
  // undefined while asking; null when nothing is booked; "unknown" if the API
  // did not answer, when the line below must not claim there is nothing.
  const [next, setNext] = useState<BookingView | null | "unknown" | undefined>(undefined);

  useEffect(() => {
    let live = true;
    session
      .request("/bookings?limit=50")
      .then((res) => (res.ok ? (res.json() as Promise<BookingPage>) : Promise.reject()))
      .then((page) => {
        if (live) setNext(nextBooked(page.bookings, Date.now()));
      })
      .catch(() => {
        if (live) setNext("unknown");
      });
    return () => {
      live = false;
    };
  }, []);

  if (next && next !== "unknown") return <NextClassCard booking={next} />;
  return (
    // Kept in place while asking, invisible, so the buttons below don't jump
    // for the many people who have nothing booked yet.
    <p className={`${lead} ${next === undefined ? "invisible" : ""}`}>
      {next === null
        ? "You have no classes booked yet. Pick a date and we’ll save your place."
        : "Pick a date and we’ll save your place."}
    </p>
  );
}

function NextClassCard({ booking }: { booking: BookingView }) {
  const s = booking.session;
  return (
    <div className="relative mt-6 max-w-md rounded-[var(--radius-card)] border-2 border-line bg-card p-5 transition-shadow hover:shadow-lg has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-4 has-[a:focus-visible]:outline-purple">
      <p className="font-semibold text-subtle">Your next class</p>
      <div className="mt-3 flex items-center gap-4">
        <DateTile iso={s.startsAt} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="font-display text-[1.3rem] leading-tight font-semibold text-plum">
            {/* The whole card is this one link. */}
            <Link
              href={bookingPath(booking.reference)}
              className="after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline-none"
            >
              {s.workshop.title}
            </Link>
          </p>
          <p className="font-semibold text-ink">
            <time dateTime={s.startsAt}>{formatLongDay(s.startsAt)}</time>,{" "}
            <span className="whitespace-nowrap">{formatTime(s.startsAt)}</span>
          </p>
          <p className="text-muted">{placeOf(s.workshop.deliveryMode, s.location)}</p>
        </div>
        <Icon name="arrow" className="hidden size-6 text-purple sm:block" />
      </div>
    </div>
  );
}
