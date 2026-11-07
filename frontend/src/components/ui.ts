/**
 * Shared class lists, so a button looks and measures the same on every page.
 * Primary actions are at least 48px tall, everything tappable at least 44px.
 */

const pill =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-base font-semibold transition-colors";

/** The everyday primary action, on paper or white. */
export const buttonPrimary = `${pill} bg-purple text-white hover:bg-plum`;

/** The gold "Book a class" button. Dark grounds only: gold fails on paper. */
export const buttonGold = `${pill} bg-gold font-bold text-on-gold hover:bg-[#f0b24f]`;

/** Secondary action, on paper or white. */
export const buttonOutline = `${pill} border-2 border-purple bg-transparent text-purple hover:bg-lilac`;

/** Body-size link: purple, never ochre (ochre is 24px+ only). */
export const textLink =
  "font-semibold text-purple underline decoration-2 underline-offset-4 hover:text-plum";

export const pageWrap = "mx-auto w-full max-w-6xl px-5 sm:px-8";
