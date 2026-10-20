/** The pure side of the waveform: peaks in, bars out. No DOM. */

export const BAR_WIDTH = 2;
export const BAR_GAP = 1;
/** The shortest bar, so silence is still a visible dotted line. */
export const MIN_BAR = 2;
/** Height of the mirror image relative to the bars (§3.6): 35 %, drawn at .4 opacity. */
export const REFLECTION_RATIO = 0.35;

const finite01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** Clamps every peak to 0..1; NaN and Infinity become 0. */
export function sanitizePeaks(peaks: ArrayLike<number>): number[] {
  const out: number[] = new Array<number>(peaks.length);
  for (let i = 0; i < peaks.length; i += 1) out[i] = finite01(peaks[i] ?? 0);
  return out;
}

/**
 * Brings `peaks` to exactly `count` bars. Fewer bars than peaks: each bar takes the maximum of its slice
 * (a loud syllable never disappears). More bars than peaks: values are interpolated. Empty input gives
 * `count` zeros, so a recording that has no picture yet still draws a line.
 */
export function resamplePeaks(peaks: ArrayLike<number>, count: number): number[] {
  const n = Math.max(0, Math.floor(count));
  const clean = sanitizePeaks(peaks);
  if (n === 0) return [];
  if (clean.length === 0) return new Array<number>(n).fill(0);
  if (clean.length === n) return clean;
  const out: number[] = new Array<number>(n);
  if (clean.length > n) {
    const ratio = clean.length / n;
    for (let i = 0; i < n; i += 1) {
      const from = Math.floor(i * ratio);
      const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
      let max = 0;
      for (let j = from; j < to && j < clean.length; j += 1) max = Math.max(max, clean[j] ?? 0);
      out[i] = max;
    }
    return out;
  }
  for (let i = 0; i < n; i += 1) {
    const pos = n === 1 ? 0 : (i / (n - 1)) * (clean.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(clean.length - 1, lo + 1);
    const a = clean[lo] ?? 0;
    out[i] = a + ((clean[hi] ?? 0) - a) * (pos - lo);
  }
  return out;
}

/** How many bars of `barWidth` + `gap` fit in `width` px (the last bar has no gap after it). */
export function barCount(width: number, barWidth = BAR_WIDTH, gap = BAR_GAP): number {
  if (!Number.isFinite(width) || width < barWidth) return 0;
  return Math.floor((width + gap) / (barWidth + gap));
}

export interface Bar {
  /** Centre x of the bar. */
  x: number;
  /** Height of the bar above the baseline. */
  height: number;
}

/** Lays the bars out across `width` px, centred, with heights `peak * maxHeight` (never below MIN_BAR). */
export function layoutBars(peaks: ArrayLike<number>, width: number, maxHeight: number, barWidth = BAR_WIDTH, gap = BAR_GAP): Bar[] {
  const n = barCount(width, barWidth, gap);
  if (n === 0) return [];
  const values = resamplePeaks(peaks, n);
  const used = n * barWidth + (n - 1) * gap;
  const left = (width - used) / 2;
  return values.map((value, i) => ({
    x: left + i * (barWidth + gap) + barWidth / 2,
    height: Math.max(MIN_BAR, value * maxHeight),
  }));
}

/** SVG path data of vertical strokes from the baseline up (`direction` -1) or down (+1). */
export function barsPath(bars: readonly Bar[], baseline: number, direction: 1 | -1, scale = 1): string {
  let d = '';
  for (const bar of bars) {
    const x = Math.round(bar.x * 100) / 100;
    const end = Math.round((baseline + direction * bar.height * scale) * 100) / 100;
    d += `M${x} ${baseline}V${end}`;
  }
  return d;
}

// ───────── Scrubbing ─────────

/** Position of a pointer along the wave as a fraction 0..1. */
export function fractionAt(clientX: number, left: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(1, Math.max(0, (clientX - left) / width));
}

export type SeekKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'PageUp' | 'PageDown' | 'Home' | 'End';

export const SEEK_KEYS: readonly SeekKey[] = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
];

/** One arrow press moves 5 s (or 2 % of an unknown length); Shift makes it 15 s; Page keys jump 10 %. */
export const SEEK_STEP_SECONDS = 5;
export const SEEK_BIG_STEP_SECONDS = 15;
export const SEEK_FALLBACK_STEP = 0.02;
export const SEEK_PAGE_STEP = 0.1;

/** The new fraction after a key press, or null when the key is not a seek key. */
export function seekFromKey(key: string, fraction: number, durationSec: number | undefined, shift = false): number | null {
  const now = finite01(fraction);
  const hasDuration = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0;
  const step = hasDuration
    ? (shift ? SEEK_BIG_STEP_SECONDS : SEEK_STEP_SECONDS) / (durationSec as number)
    : shift
      ? SEEK_FALLBACK_STEP * 3
      : SEEK_FALLBACK_STEP;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return finite01(now - step);
    case 'ArrowRight':
    case 'ArrowUp':
      return finite01(now + step);
    case 'PageDown':
      return finite01(now - SEEK_PAGE_STEP);
    case 'PageUp':
      return finite01(now + SEEK_PAGE_STEP);
    case 'Home':
      return 0;
    case 'End':
      return 1;
    default:
      return null;
  }
}
