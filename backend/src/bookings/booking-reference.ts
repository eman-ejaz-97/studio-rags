import { randomInt } from 'node:crypto';

/**
 * The characters a reference is made of: digits and capitals without the ones
 * people confuse when reading a reference aloud or copying it from an email
 * (0 and O, 1, I and L, and U, which can read as V). 30 symbols.
 */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

const PREFIX = 'SR-';
const LENGTH = 5;

/**
 * SR- and five symbols, e.g. SR-7K4M2: 30^5, about 24 million. Short enough to
 * read over the phone; collisions are rare at her volume and the booking
 * service simply draws again when one happens.
 */
export const REFERENCE_PATTERN = new RegExp(
  `^${PREFIX}[${REFERENCE_ALPHABET}]{${LENGTH}}$`,
);

/** A fresh reference from the crypto random source. */
export function newBookingReference(): string {
  let code = '';
  for (let i = 0; i < LENGTH; i += 1) {
    code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  }
  return `${PREFIX}${code}`;
}

/**
 * The reference as stored, or null if it cannot be one. Typed references
 * arrive in lower case or with stray spaces; anything else is answered as
 * "not found" without a database query.
 */
export function normaliseReference(input: string): string | null {
  const reference = input.trim().toUpperCase();
  return REFERENCE_PATTERN.test(reference) ? reference : null;
}
