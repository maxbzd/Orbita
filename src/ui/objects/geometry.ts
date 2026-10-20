import { hashString } from '../viz/hash';
import { TAU, polar, round } from '../viz/polar';
import type { Point } from '../viz/polar';

/**
 * Pure helpers behind the shareable objects: text fitting for SVG
 * (an SVG `<text>` does not wrap), the plump five-ray star, barcode bars from a hash, the passport's
 * machine-readable lines and the poster's month dots. No React, no DOM.
 */

// ───────── Text fitting ─────────

/** Average advance of one glyph as a share of the font size. Deliberately generous: wrapping early beats overflowing. */
export const GLYPH_RATIO = {
  /** Literata (serif thought text). */
  serif: 0.54,
  /** Onest (UI sans). */
  sans: 0.56,
  /** IBM Plex Mono: exactly 0.6 em. */
  mono: 0.6,
  /** Unbounded capitals at weight 800. */
  poster: 0.9,
} as const;

export function textWidth(text: string, fontSize: number, ratio: number = GLYPH_RATIO.serif): number {
  return [...text].length * fontSize * ratio;
}

/**
 * Greedy word wrap by estimated width. A word wider than the line is split by characters. When the text needs more
 * than `maxLines` lines, the last one is cut and ends with an ellipsis (`truncated` tells the caller).
 */
export function wrapLines(
  text: string,
  maxWidth: number,
  fontSize: number,
  { ratio = GLYPH_RATIO.serif, maxLines = Infinity }: { ratio?: number; maxLines?: number } = {},
): { lines: string[]; truncated: boolean } {
  const perLine = Math.max(1, Math.floor(maxWidth / (fontSize * ratio)));
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  const push = (): void => {
    if (current) lines.push(current);
    current = '';
  };
  for (const word of words) {
    let rest = [...word];
    while (rest.length > perLine) {
      // A word longer than a whole line: break it where the line ends.
      if (current) push();
      lines.push(rest.slice(0, perLine).join(''));
      rest = rest.slice(perLine);
    }
    const piece = rest.join('');
    if (!current) current = piece;
    else if ([...current].length + 1 + rest.length <= perLine) current += ` ${piece}`;
    else {
      push();
      current = piece;
    }
  }
  push();
  if (lines.length <= maxLines) return { lines, truncated: false };
  const kept = lines.slice(0, maxLines);
  const last = [...(kept[maxLines - 1] ?? '')];
  const room = Math.max(1, perLine - 1);
  kept[maxLines - 1] = `${last
    .slice(0, room)
    .join('')
    .trimEnd()
    .replace(/[.,;:!?—–-]+$/u, '')}…`;
  return { lines: kept, truncated: true };
}

export interface FittedParagraph {
  fontSize: number;
  lineHeight: number;
  lines: string[];
  truncated: boolean;
}

/**
 * The largest size from `sizes` (descending) at which the paragraph fits a box; the smallest size is used (with an
 * ellipsis) when nothing fits.
 */
export function fitParagraph(
  text: string,
  boxWidth: number,
  boxHeight: number,
  {
    sizes = [24, 22, 20, 18, 16, 14, 13],
    lineHeight = 1.3,
    ratio = GLYPH_RATIO.serif,
  }: { sizes?: readonly number[]; lineHeight?: number; ratio?: number } = {},
): FittedParagraph {
  const ordered = [...sizes].sort((a, b) => b - a);
  for (const fontSize of ordered) {
    const maxLines = Math.max(1, Math.floor(boxHeight / (fontSize * lineHeight)));
    const { lines, truncated } = wrapLines(text, boxWidth, fontSize, { ratio, maxLines });
    if (!truncated) return { fontSize, lineHeight, lines, truncated };
  }
  const fontSize = ordered[ordered.length - 1] ?? 13;
  const maxLines = Math.max(1, Math.floor(boxHeight / (fontSize * lineHeight)));
  return { fontSize, lineHeight, ...wrapLines(text, boxWidth, fontSize, { ratio, maxLines }) };
}

/** Font size that makes `text` as wide as `width` (docs §2.4 `fitText`), within [min, max]. */
export function fitFontSize(
  text: string,
  width: number,
  { ratio = GLYPH_RATIO.poster, min = 12, max = 240 }: { ratio?: number; min?: number; max?: number } = {},
): number {
  const chars = Math.max(1, [...text].length);
  return Math.min(max, Math.max(min, round(width / (chars * ratio), 1)));
}

// ───────── The plump five-ray star ─────────

export interface StarOptions {
  rays?: number;
  /** Valley radius as a share of the outer radius. */
  inner?: number;
  /** Below 1 the rays get broader and rounder (and the valleys narrower). */
  plump?: number;
  samples?: number;
  /** Rotation in radians (clockwise); 0 puts a ray straight up. */
  rotation?: number;
}

/** Radius of the star contour at angle θ (clockwise from the top), as a share of the outer radius. */
export function starRadius(theta: number, { rays = 5, inner = 0.62, plump = 0.75, rotation = 0 }: StarOptions = {}): number {
  const t = (Math.cos(rays * (theta - rotation)) + 1) / 2;
  return inner + (1 - inner) * t ** plump;
}

export function starPoints(cx: number, cy: number, outer: number, options: StarOptions = {}): Point[] {
  const samples = options.samples ?? 180;
  return Array.from({ length: samples }, (_, i) => {
    const theta = (i / samples) * TAU;
    return polar(cx, cy, outer * starRadius(theta, options), theta);
  });
}

export function starPath(cx: number, cy: number, outer: number, options: StarOptions = {}): string {
  const points = starPoints(cx, cy, outer, options);
  return `${points.map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)} ${round(p.y)}`).join('')}Z`;
}

// ───────── Barcode ─────────

export interface BarcodeBar {
  x: number;
  width: number;
}

/**
 * A decorative barcode derived from a seed: `bars` black bars separated by gaps, alternately 1–3 units wide, scaled so
 * the whole code is exactly `width` wide. The same seed always draws the same code. It encodes nothing.
 */
export function barcodeBars(seed: string, width: number, bars = 22): BarcodeBar[] {
  let state = hashString(seed) || 1;
  const next = (): number => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
  const units: number[] = [];
  for (let i = 0; i < bars * 2 - 1; i++) units.push(1 + (next() % 3));
  const total = units.reduce((a, b) => a + b, 0);
  const scale = width / total;
  const result: BarcodeBar[] = [];
  let x = 0;
  units.forEach((u, i) => {
    if (i % 2 === 0) result.push({ x: round(x), width: round(u * scale) });
    x += u * scale;
  });
  return result;
}

// ───────── Passport machine-readable zone ─────────

const MRZ_LENGTH = 44;

function mrzValue(char: string): number {
  if (char >= '0' && char <= '9') return char.charCodeAt(0) - 48;
  if (char >= 'A' && char <= 'Z') return char.charCodeAt(0) - 55;
  return 0; // '<'
}

/** ICAO 9303 check digit: weights 7-3-1 over digits (0–9), letters (A=10…) and filler (0). */
export function mrzCheckDigit(text: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < text.length; i++) sum += mrzValue(text[i] ?? '<') * (weights[i % 3] ?? 1);
  return sum % 10;
}

function field(value: number, width: number): string {
  const n = Math.min(10 ** width - 1, Math.max(0, Math.round(Number.isFinite(value) ? value : 0)));
  return String(n).padStart(width, '0');
}

export interface MrzInput {
  year: number;
  /** The hero number (records in the year). */
  hero: number;
  /** The four numbers printed on the page. */
  stats: readonly number[];
  /** Issue date as `YYYY-MM-DD`. */
  issuedOn: string;
}

function pad44(text: string): string {
  return text.length >= MRZ_LENGTH ? text.slice(0, MRZ_LENGTH) : text + '<'.repeat(MRZ_LENGTH - text.length);
}

/**
 * Two 44-character lines in the passport style, built from the real numbers of the year. Decorative by design:
 * latin capitals, digits and `<` only, no names or text of the user (docs §4.1 risk 18).
 */
export function buildMrz({ year, hero, stats, issuedOn }: MrzInput): [string, string] {
  const first = pad44(`P<LIF<<GOD<${field(year, 4)}<<REC${field(hero, 5)}`);
  const issued = issuedOn.replace(/-/g, '').slice(2, 8).padEnd(6, '0');
  const numbers = [...stats, 0, 0, 0, 0].slice(0, 4).map((s) => field(s, 5));
  const body = `${field(year, 4)}${numbers[0]}<${numbers[1]}<${numbers[2]}<${numbers[3]}<${issued}`;
  const secondRaw = `${body}${mrzCheckDigit(body)}`;
  return [first, pad44(secondRaw)];
}

// ───────── Poster dots ─────────

export interface MonthDot {
  day: number;
  col: number;
  row: number;
  mood: number | null;
}

/** Day of the week (Monday = 0) of the first of a month (month 1…12). */
export function firstWeekday(year: number, month: number): number {
  const sunday0 = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return (sunday0 + 6) % 7;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** A Monday-first calendar of dots for the poster: one dot per day, mood from `moods[day − 1]`. */
export function monthDots(year: number, month: number, moods: readonly (number | null | undefined)[] = []): MonthDot[] {
  const offset = firstWeekday(year, month);
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => ({
    day: i + 1,
    col: (offset + i) % 7,
    row: Math.floor((offset + i) / 7),
    mood: moods[i] ?? null,
  }));
}

// ───────── Passport arcs ─────────

/**
 * Sweep (radians) of each concentric arc: the largest value takes `maxSweep`, the others in proportion. A positive
 * value never shrinks below `minSweep`, so a small number is still visible; zero or invalid gives zero.
 */
export function proportionalSweeps(values: readonly number[], maxSweep = (TAU * 5) / 6, minSweep = 0.12): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const max = Math.max(0, ...clean);
  if (max === 0) return clean.map(() => 0);
  return clean.map((v) => (v === 0 ? 0 : Math.min(maxSweep, Math.max(minSweep, (v / max) * maxSweep))));
}
