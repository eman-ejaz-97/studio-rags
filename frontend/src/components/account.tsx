"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { session, type User } from "@/lib/session";
import { useSignedInName } from "@/lib/use-signed-in-name";
import { ApiUnavailable } from "./api-unavailable";
import { buttonOutline, textLink } from "./ui";

/**
 * "Sign in" for visitors. Once signed in, a pill with the first name's initial
 * and "Hi, Eman", so it is plain at a glance that the site knows who you are.
 * The server cannot see the session (the cookies belong to the API's routes),
 * so the server-rendered header always starts as "Sign in".
 */
export function AccountLink() {
  const name = useSignedInName();
  const base = "inline-flex min-h-11 items-center rounded-full font-semibold text-purple hover:bg-lilac";

  if (name === null) {
    return (
      <Link href="/sign-in" className={`${base} px-3`}>
        Sign in
      </Link>
    );
  }
  if (name === "") {
    return (
      <Link href="/account" className={`${base} px-3`}>
        Your account
      </Link>
    );
  }
  // On a phone only the initial shows, so the header stays on one row beside
  // the logo; the home page greets by name in its heading instead.
  return (
    <Link href="/account" className={`${base} gap-2 p-1 sm:pr-3`}>
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-full bg-plum text-base font-bold text-white"
      >
        {initialOf(name)}
      </span>
      {/* The visible words lead the accessible name ("Hi, Eman, your account"). */}
      <span className="sr-only sm:not-sr-only">
        <span className="block max-w-[14ch] truncate">
          Hi, {name}
          <span className="sr-only">, your account</span>
        </span>
      </span>
    </Link>
  );
}

/** The first letter, whole even when it is two UTF-16 units (an emoji, say). */
function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "";
}

type State =
  | { state: "loading" }
  | { state: "ready"; user: User }
  | { state: "unavailable" };

export function AccountPanel() {
  const router = useRouter();
  const [s, setS] = useState<State>({ state: "loading" });
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let live = true;
    session
      .me()
      .then((user) => {
        if (!live) return;
        if (user) setS({ state: "ready", user });
        else router.replace("/sign-in?next=/account");
      })
      .catch(() => live && setS({ state: "unavailable" }));
    return () => {
      live = false;
    };
  }, [router]);

  async function signOut() {
    setSigningOut(true);
    await session.signOut();
    router.replace("/");
    router.refresh();
  }

  if (s.state === "unavailable") return <ApiUnavailable what="your account" />;
  if (s.state === "loading") {
    return (
      <p role="status" className="text-muted">
        Loading your account…
      </p>
    );
  }

  const { user } = s;
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-[clamp(2.2rem,5vw,3.2rem)] leading-tight font-black text-plum">
          Hello, {user.firstName}
        </h1>
        <p className="mt-2 text-body">
          Signed in as <span className="font-semibold">{user.email}</span>
        </p>
      </div>

      <section className="rounded-[var(--radius-card)] border-2 border-line bg-card p-6">
        <h2 className="font-display text-2xl font-semibold text-plum">Your bookings</h2>
        <p className="mt-2 text-body">
          You have no bookings yet. When you book a class, it will appear here with its date and
          your receipt.
        </p>
        <Link href="/classes" className={`${textLink} mt-4 inline-flex`}>
          Browse the classes
        </Link>
      </section>

      <div>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          aria-disabled={signingOut}
          className={buttonOutline}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
