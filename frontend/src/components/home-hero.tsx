"use client";

import Link from "next/link";
import { useSignedInName } from "@/lib/use-signed-in-name";
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
 * is welcomed back by name and sent straight to the classes. The server
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
      {/* When bookings land in phase 3, a card with the next booked class
          takes this line's place for anyone who has one. */}
      <p className={lead}>
        You have no classes booked yet. Pick a date and we’ll save your seat.
      </p>
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
