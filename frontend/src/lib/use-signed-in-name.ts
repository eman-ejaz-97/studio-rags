"use client";

import { useEffect, useSyncExternalStore } from "react";
import { SESSION_CHANGED, SIGNED_IN_HINT, hintedFirstName, session } from "./session";

/**
 * Who is signed in on this browser, for greeting them: their first name, an
 * empty string if signed in but the name is not known yet, or null for a
 * visitor.
 *
 * It reads the hint, so the greeting shows as soon as the page hydrates rather
 * than after a sleeping API wakes. The server never knows (the cookies belong
 * to the API's routes), so the server-rendered page is always the visitor's.
 * One check with the API per page load then confirms or clears the hint.
 */
export function useSignedInName(): string | null {
  const name = useSyncExternalStore(subscribe, hintedFirstName, () => null);

  useEffect(() => {
    // Unreachable API: keep the hinted greeting rather than flicker to a visitor.
    confirming ??= session.meIfHinted().catch(() => null);
  }, []);

  return name;
}

/** Shared by every component using the hook, so the header and hero ask once. */
let confirming: Promise<unknown> | null = null;

function subscribe(onChange: () => void) {
  // "storage" fires when another tab signs in or out.
  const onStorage = (e: StorageEvent) => {
    if (e.key === SIGNED_IN_HINT || e.key === null) onChange();
  };
  window.addEventListener(SESSION_CHANGED, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SESSION_CHANGED, onChange);
    window.removeEventListener("storage", onStorage);
  };
}
