import type { CSSProperties } from 'react';

/**
 * Fabric Fun (ADR-021) for email, from the same tokens as
 * frontend/src/app/globals.css. Email clients ignore stylesheets and most web
 * fonts, so styles are inline and each font names a common fallback.
 *
 * The colour rule holds here too: purples carry the text. Gold and ochre are
 * left out, because on a light ground gold fails AA and ochre only passes at
 * 24px and above.
 */
export const colour = {
  paper: '#FFFCF6',
  card: '#FFFFFF',
  line: '#EFE6F2',
  plum: '#4E2B4B',
  purple: '#5B3460',
  ink: '#2B2033',
  muted: '#5C4D66',
  onPurple: '#FFFFFF',
} as const;

const displayFont = "Fraunces, Georgia, 'Times New Roman', serif";
const bodyFont =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/** 17px body text, never below 16px (CLAUDE.md non-negotiables). */
export const text: CSSProperties = {
  fontFamily: bodyFont,
  fontSize: '17px',
  lineHeight: '28px',
  color: colour.ink,
  margin: '0 0 16px',
};

export const heading: CSSProperties = {
  fontFamily: displayFont,
  fontSize: '30px',
  lineHeight: '38px',
  fontWeight: 600,
  color: colour.plum,
  margin: '0 0 20px',
};

export const subheading: CSSProperties = {
  fontFamily: displayFont,
  fontSize: '22px',
  lineHeight: '30px',
  fontWeight: 600,
  color: colour.plum,
  margin: '28px 0 12px',
};

/** A pill button at least 48px tall: 20px of line plus 28px of padding. */
export const button: CSSProperties = {
  backgroundColor: colour.purple,
  color: colour.onPurple,
  fontFamily: bodyFont,
  fontSize: '17px',
  lineHeight: '20px',
  fontWeight: 600,
  textDecoration: 'none',
  borderRadius: '999px',
  padding: '14px 28px',
};

export const link: CSSProperties = {
  color: colour.purple,
  textDecoration: 'underline',
  wordBreak: 'break-all',
};

export const muted: CSSProperties = {
  ...text,
  color: colour.muted,
  fontSize: '16px',
  lineHeight: '26px',
};

export const fonts = { display: displayFont, body: bodyFont } as const;
