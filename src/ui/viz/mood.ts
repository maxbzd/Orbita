import { mixOklch } from './color';
import { clamp } from './polar';
import { t } from '../../i18n';

/**
 * The mood scale −3…+3: every step has a colour, a shape (the
 * flower) and a word, so colour is never the only carrier of meaning.
 */

export const MOOD_STEPS = [-3, -2, -1, 0, 1, 2, 3] as const;
export type MoodStep = (typeof MOOD_STEPS)[number];

/** CSS token of each step (`--m-n3` … `--m-p3`). */
export const MOOD_TOKEN: Record<MoodStep, string> = {
  [-3]: '--m-n3',
  [-2]: '--m-n2',
  [-1]: '--m-n1',
  0: '--m-0',
  1: '--m-p1',
  2: '--m-p2',
  3: '--m-p3',
};

/**
 * The token values as hex. Both themes share the mood ramp (themes.css defines it once), and
 * `mood.test.ts` checks this table against the stylesheet so the two cannot drift apart.
 */
export const MOOD_HEX: Record<MoodStep, string> = {
  [-3]: '#7a5bd6',
  [-2]: '#5b6fe0',
  [-1]: '#4f8df0',
  0: '#bfe3ee',
  1: '#a9d86b',
  2: '#f5cf4f',
  3: '#f7a22e',
};

export const MOOD_WORDS: Record<MoodStep, string> = {
  get [-3]() { return t('Very hard') },
  get [-2]() { return t('Hard') },
  get [-1]() { return t('Not great') },
  get 0() { return t('Steady') },
  get 1() { return t('Calm') },
  get 2() { return t('Pleasant') },
  get 3() { return t('Great') },
};

/** Clamps a mood value into −3…+3 (NaN counts as 0). */
export function clampMood(value: number): number {
  return Number.isFinite(value) ? clamp(value, -3, 3) : 0;
}

/** Nearest step; halves round away from zero, so −0.5 and +0.5 never both land on 0. */
export function moodStep(value: number): MoodStep {
  const v = clampMood(value);
  return (Math.sign(v) * Math.round(Math.abs(v)) || 0) as MoodStep;
}

export function moodWord(value: number): string {
  return MOOD_WORDS[moodStep(value)];
}

/** "Приятно, +2" — the word and the number, for spoken values. */
export function moodSpoken(value: number): string {
  const step = moodStep(value);
  return `${MOOD_WORDS[step]}, ${step > 0 ? '+' : ''}${step}`;
}

/** CSS reference of the nearest step's colour (follows the theme tokens). */
export function moodVar(value: number): string {
  return `var(${MOOD_TOKEN[moodStep(value)]})`;
}

/** Colour of a mood value, interpolated in OKLCH between the two neighbouring steps. */
export function moodHex(value: number): string {
  const v = clampMood(value);
  const lo = Math.floor(v);
  const hi = Math.ceil(v);
  if (lo === hi) return MOOD_HEX[lo as MoodStep];
  return mixOklch(MOOD_HEX[lo as MoodStep], MOOD_HEX[hi as MoodStep], v - lo);
}

/** Text colour that reads on a filled mood shape (for example the number on the planet). */
export const MOOD_INK_DARK = '#0b0c1a';
export const MOOD_INK_LIGHT = '#f7f8ff';

const channel = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function luminanceOf(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((k) => channel(parseInt(h.slice(k, k + 2), 16) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two hex colours. */
export function contrastRatio(a: string, b: string): number {
  const la = luminanceOf(a);
  const lb = luminanceOf(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Whichever of the dark and light inks has the higher contrast on this mood's fill. */
export function moodInk(value: number): string {
  const fill = moodHex(value);
  return contrastRatio(MOOD_INK_DARK, fill) >= contrastRatio(MOOD_INK_LIGHT, fill) ? MOOD_INK_DARK : MOOD_INK_LIGHT;
}
