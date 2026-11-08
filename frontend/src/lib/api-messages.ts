/**
 * What a form says when the API itself is the problem. Shared, so every page
 * that writes to the API words a failure the same way.
 */

export const OFFLINE =
  "We couldn’t reach Studio Rags. Check your internet connection and try again.";

export const WAKING =
  "The booking system is waking up after a quiet spell. Please try again in a minute.";

// session.ts has already fetched a fresh security token and tried again, so
// a browser refusing cookies is the likely reason left.
export const COOKIES =
  "We couldn’t send this safely. Please check that cookies are allowed for this site, then try again.";
