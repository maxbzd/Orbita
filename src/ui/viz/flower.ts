import { clamp, polygonPath, TAU } from './polar';
import type { Point } from './polar';
import { clampMood } from './mood';

/**
 * The mood-flower formula: a polar contour
 *   r(θ) = R · (1 + a(v) · f(kθ))
 *   v < 0: k = 8, a = 0.30·|v|/3, f = sign(cos)·|cos|^0.6   (star → jagged cloud → wavy flower)
 *   v = 0: a = 0                                             (a circle)
 *   v > 0: k = 5, a = 0.06 + 0.16·v/3, f = cos               (rounded pentagon → star → five petals)
 * The spec's positive branch jumps from a = 0 to a = 0.06 at v = 0+. To honour "while the slider
 * passes from −1 to +1 the flower goes through a circle", the positive amplitude here is faded in
 * over 0 < v < 1 (`min(1, v)`); at every whole step ≥ 1 it equals the spec exactly.
 */

export const FLOWER_POINTS = 96;

export interface FlowerShape {
  /** Number of lobes. */
  k: number;
  /** Relative amplitude of the lobes. */
  a: number;
  /** Which lobe profile applies. */
  profile: 'sharp' | 'cosine' | 'circle';
}

/** Lobe count and amplitude for a mood value in −3…+3 (fractions allowed). */
export function flowerShape(value: number): FlowerShape {
  const v = clampMood(value);
  if (v === 0) return { k: 5, a: 0, profile: 'circle' };
  if (v < 0) return { k: 8, a: (0.3 * Math.abs(v)) / 3, profile: 'sharp' };
  return { k: 5, a: (0.06 + (0.16 * v) / 3) * Math.min(1, v), profile: 'cosine' };
}

/** The sharpened cosine of the negative branch: sign(cos x)·|cos x|^0.6. */
export function sharpCos(x: number): number {
  const c = Math.cos(x);
  return Math.sign(c) * Math.abs(c) ** 0.6;
}

/** Radius at angle θ (clockwise from the top), as a multiple of the base radius. */
export function flowerRadius(theta: number, value: number): number {
  const { k, a, profile } = flowerShape(value);
  if (profile === 'circle') return 1;
  const f = profile === 'sharp' ? sharpCos(k * theta) : Math.cos(k * theta);
  return 1 + a * f;
}

/** The largest radius the contour can reach, relative to the base radius. */
export function flowerReach(value: number): number {
  return 1 + flowerShape(value).a;
}

export interface FlowerOptions {
  /** Outer box in px; the contour is scaled to fit it exactly. Default 120. */
  size?: number;
  /** Number of contour points. Default 96. */
  points?: number;
  /** Centre; defaults to the middle of the box. */
  cx?: number;
  cy?: number;
}

/** Contour points around the centre. Point 0 is straight up, so petals point to the top. */
export function flowerPoints(value: number, { size = 120, points = FLOWER_POINTS, cx, cy }: FlowerOptions = {}): Point[] {
  const centerX = cx ?? size / 2;
  const centerY = cy ?? size / 2;
  // Fit the biggest lobe into the box with a hair of margin, so the contour never clips.
  const base = ((size / 2) * 0.96) / flowerReach(value);
  const out: Point[] = [];
  for (let i = 0; i < points; i++) {
    const theta = (i / points) * TAU;
    const r = base * flowerRadius(theta, value);
    out.push({ x: centerX + r * Math.sin(theta), y: centerY - r * Math.cos(theta) });
  }
  return out;
}

/** Closed SVG path of the contour. */
export function flowerPath(value: number, options: FlowerOptions = {}): string {
  return polygonPath(flowerPoints(value, options));
}

/**
 * The flower for a normalised level −1…+1 (a continuous slider): the same shape as `value = 3·level`.
 */
export function levelToValue(level: number): number {
  return clamp(level, -1, 1) * 3;
}
