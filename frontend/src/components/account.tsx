"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SESSION_CHANGED, hintedSignedIn, session, type User } from "@/lib/session";
import { ApiUnavailable } from "./api-unavailable";
import { buttonOutline, textLink } from "./ui";

/**
 * "Sign in" for visitors, "Your account" once signed in. It starts as "Sign
 * in" because the server cannot see the session: the cookies belong to the
 * API's routes, and reading them here would make every page dynamic.
 */
export function AccountLink() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let live = true;
    session
      .meIfHinted()
      .then((user) => live && setSignedIn(Boolean(user)))
      .catch(() => live && setSignedIn(hintedSignedIn()));
    const onChange = () => setSignedIn(hintedSignedIn());
    window.addEventListener(SESSION_CHANGED, onChange);
    return () => {
      live = false;
      window.removeEventListener(SESSION_CHANGED, onChange);
    };
  }, []);

  return (
    <Link
      href={signedIn ? "/account" : "/sign-in"}
      className="inline-flex min-h-11 items-center rounded-full px-3 font-semibold text-purple hover:bg-lilac"
    >
      {signedIn ? "Your account" : "Sign in"}
    </Link>
  );
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
