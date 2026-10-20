/**
 * Self-hosted fonts (no CDN at runtime). Importing this module loads the eager set:
 * Onest (UI), Literata (thought), Cormorant Garamond (display), JetBrains Mono 500 (labels, numerals).
 * Only the cyrillic and latin subsets are shipped (see fonts.css); `font-display: swap` everywhere.
 *
 * The rest is loaded on demand and cached by the service worker with the other build output.
 */
import './fonts.css';

let italics: Promise<unknown> | undefined;
let poster: Promise<unknown> | undefined;

/** Literata and Cormorant italics: mood words, quotes. Safe to call repeatedly. */
export function loadItalicFonts(): Promise<unknown> {
  italics ??= import('./fonts-italic.css');
  return italics;
}

/** Unbounded for review covers and the passport number. Safe to call repeatedly. */
export function loadPosterFont(): Promise<unknown> {
  poster ??= import('./fonts-poster.css');
  return poster;
}
