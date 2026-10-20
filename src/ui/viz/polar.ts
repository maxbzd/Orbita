/**
 * Polar geometry shared by every ring and orbit.
 * Angles are in radians, measured clockwise from the top (12 o'clock), the way a clock reads:
 * x = cx + r·sin θ, y = cy − r·cos θ.
 */

export const TAU = Math.PI * 2;

export interface Point {
  x: number;
  y: number;
}

export const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Rounds for SVG output: short strings, no `-0`. */
export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function polar(cx: number, cy: number, r: number, theta: number): Point {
  return { x: cx + r * Math.sin(theta), y: cy - r * Math.cos(theta) };
}

/** Angle (clockwise from the top, in (−π, π]) of a point as seen from a centre. */
export function angleOf(cx: number, cy: number, x: number, y: number): number {
  return Math.atan2(x - cx, cy - y);
}

/** Wraps an angle into [0, 2π). */
export function wrapTau(theta: number): number {
  const wrapped = theta % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
}

const f = (value: number): string => String(round(value));

/**
 * SVG path of a clockwise arc from `a0` to `a1`. A sweep of a full turn or more is split in two
 * halves (a single `A` command cannot draw a closed circle). Returns '' for an empty sweep.
 */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const sweep = a1 - a0;
  if (!(sweep > 1e-6)) return '';
  if (sweep >= TAU - 1e-6) {
    const top = polar(cx, cy, r, a0);
    const bottom = polar(cx, cy, r, a0 + Math.PI);
    return `M${f(top.x)} ${f(top.y)}A${f(r)} ${f(r)} 0 1 1 ${f(bottom.x)} ${f(bottom.y)}A${f(r)} ${f(r)} 0 1 1 ${f(top.x)} ${f(top.y)}`;
  }
  const start = polar(cx, cy, r, a0);
  const end = polar(cx, cy, r, a1);
  return `M${f(start.x)} ${f(start.y)}A${f(r)} ${f(r)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${f(end.x)} ${f(end.y)}`;
}

/** Filled ring segment (annulus sector) between two radii. */
export function sectorPath(cx: number, cy: number, rIn: number, rOut: number, a0: number, a1: number): string {
  const sweep = a1 - a0;
  if (!(sweep > 1e-6)) return '';
  const full = sweep >= TAU - 1e-6;
  const end = full ? a0 + TAU - 1e-4 : a1;
  const large = end - a0 > Math.PI ? 1 : 0;
  const o0 = polar(cx, cy, rOut, a0);
  const o1 = polar(cx, cy, rOut, end);
  const i1 = polar(cx, cy, rIn, end);
  const i0 = polar(cx, cy, rIn, a0);
  return `M${f(o0.x)} ${f(o0.y)}A${f(rOut)} ${f(rOut)} 0 ${large} 1 ${f(o1.x)} ${f(o1.y)}L${f(i1.x)} ${f(i1.y)}A${f(rIn)} ${f(rIn)} 0 ${large} 0 ${f(i0.x)} ${f(i0.y)}Z`;
}

/** `M x y L … Z` through points. */
export function polygonPath(points: readonly Point[], close = true): string {
  if (points.length === 0) return '';
  const body = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${f(p.x)} ${f(p.y)}`).join('');
  return close ? `${body}Z` : body;
}

/**
 * Index of the slot (0..count-1) a pointer angle falls into, for `count` equal slots whose first
 * slot is centred on `startAngle` and which run clockwise.
 */
export function slotAt(theta: number, count: number, startAngle = 0): number {
  if (count <= 0) return 0;
  const step = TAU / count;
  const rel = wrapTau(theta - startAngle + step / 2);
  return Math.min(count - 1, Math.floor(rel / step));
}
