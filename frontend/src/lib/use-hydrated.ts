"use client";

import { useSyncExternalStore } from "react";

const never = () => () => {};

/**
 * False on the server and during hydration, true once the page is live in
 * the browser. The booking screens wait for it before choosing between the
 * form and "sign in to book": the server cannot see the session (ADR-042), so
 * guessing would flash the wrong one at someone who is signed in.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    never,
    () => true,
    () => false,
  );
}
