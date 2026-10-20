/**
 * Orb geometry and animation maths: pure functions, no canvas, no React.
 *
 *
 * Conventions: unit sphere, +y up, +z towards the viewer. A point is a triple in a flat Float32Array.
 */

/** Fibonacci azimuth step: pi * (3 - sqrt(5)) = 2.399963... */
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Torus radii in unit-sphere units (§3.4): the ring, and the thickness of the tube. */
export const TORUS_MAJOR = 0.62;
export const TORUS_MINOR = 0.28;

const TAU = Math.PI * 2;

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
export const clamp01 = (v: number): number => (Number.isFinite(v) ? clamp(v, 0, 1) : 0);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/** Small deterministic PRNG (mulberry32): the orb must look the same on every launch and in every test. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` points spread evenly over the unit sphere along a Fibonacci spiral:
 * y = 1 - 2(i + .5)/N, r = sqrt(1 - y^2), phi = i * 2.399963. Index 0 is the north pole side.
 */
export function fibonacciSphere(count: number): Float32Array {
  const n = Math.max(0, Math.floor(count));
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * GOLDEN_ANGLE;
    out[i * 3] = r * Math.cos(phi);
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = r * Math.sin(phi);
  }
  return out;
}

/**
 * Tube angle psi in [0, 2pi) whose cumulative surface share on the torus equals `share` in [0, 1].
 * psi = 0 is the top of the tube, pi/2 the outer equator, pi the bottom, 3pi/2 the inner side.
 * The surface element grows with the distance from the axis, R + r sin(psi), so equal shares are not
 * equal angles: inverting G(psi) = (R psi + r (1 - cos psi)) / (2 pi R) with Newton steps.
 */
export function tubeAngleForShare(share: number, major = TORUS_MAJOR, minor = TORUS_MINOR): number {
  const v = clamp01(share);
  let psi = v * TAU;
  for (let k = 0; k < 8; k += 1) {
    const g = (major * psi + minor * (1 - Math.cos(psi))) / (TAU * major) - v;
    const dg = (major + minor * Math.sin(psi)) / (TAU * major);
    psi = clamp(psi - g / dg, 0, TAU);
  }
  return psi;
}

/**
 * The torus the sphere turns into, point for point. Point i keeps its azimuth around the vertical axis and
 * slides inside its own meridian plane to the tube position that matches its rank from top to bottom, so
 * the morph is a smooth fold with no crossing paths. The result is area-uniform on the torus.
 */
export function torusTargets(sphere: Float32Array, major = TORUS_MAJOR, minor = TORUS_MINOR): Float32Array {
  const n = sphere.length / 3;
  const out = new Float32Array(sphere.length);
  for (let i = 0; i < n; i += 1) {
    const theta = Math.atan2(sphere[i * 3 + 2] ?? 0, sphere[i * 3] ?? 0);
    const psi = tubeAngleForShare((i + 0.5) / n, major, minor);
    const ring = major + minor * Math.sin(psi);
    out[i * 3] = ring * Math.cos(theta);
    out[i * 3 + 1] = minor * Math.cos(psi);
    out[i * 3 + 2] = ring * Math.sin(theta);
  }
  return out;
}

/** out = from + (to - from) * t, element by element. Returns `out`. */
export function morphPositions(from: Float32Array, to: Float32Array, t: number, out: Float32Array): Float32Array {
  const k = clamp01(t);
  const len = Math.min(from.length, to.length, out.length);
  for (let i = 0; i < len; i += 1) {
    const a = from[i] ?? 0;
    out[i] = a + ((to[i] ?? 0) - a) * k;
  }
  return out;
}

// ───────── Rotation and projection ─────────

/** Row-major 3x3 matrix of "yaw about Y, then pitch about X". */
export type Rotation = Float64Array;

export function rotationYawPitch(yaw: number, pitch: number, out: Rotation = new Float64Array(9)): Rotation {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // Ry = [[cy,0,sy],[0,1,0],[-sy,0,cy]]; Rx = [[1,0,0],[0,cp,-sp],[0,sp,cp]]; out = Rx * Ry
  out[0] = cy;
  out[1] = 0;
  out[2] = sy;
  out[3] = sp * sy;
  out[4] = cp;
  out[5] = -sp * cy;
  out[6] = -cp * sy;
  out[7] = sp;
  out[8] = cp * cy;
  return out;
}

/** Writes the rotated point to out[0..2]. */
export function applyRotation(m: Rotation, x: number, y: number, z: number, out: Float64Array): void {
  out[0] = (m[0] ?? 0) * x + (m[1] ?? 0) * y + (m[2] ?? 0) * z;
  out[1] = (m[3] ?? 0) * x + (m[4] ?? 0) * y + (m[5] ?? 0) * z;
  out[2] = (m[6] ?? 0) * x + (m[7] ?? 0) * y + (m[8] ?? 0) * z;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** Orthographic projection: the unit radius becomes `radius` px around (cx, cy); screen y points down. */
export function project(x: number, y: number, radius: number, cx: number, cy: number): ScreenPoint {
  return { x: cx + x * radius, y: cy - y * radius };
}

/**
 * Opacity by depth. Front side: .25 + .75 z (§3.4). The far side is not cut off, so the torus keeps its
 * back half: it fades from .25 at the limb to 0 at the very back, continuously.
 */
export function depthAlpha(z: number): number {
  if (z >= 0) return Math.min(1, 0.25 + 0.75 * z);
  const k = 1 + Math.max(-1, z);
  return 0.25 * k * k;
}

/** Dot radius at depth z, in "design px" for a 220 px orb: 1.2 + 1.2 z (§3.4), never thinner than .5. */
export function depthRadius(z: number): number {
  return Math.max(0.5, 1.2 + 1.2 * clamp(z, -1, 1));
}

// ───────── Time ─────────

/**
 * CSS cubic-bezier as a function of progress. Newton's method with a bisection fallback; x(t) is
 * monotonic for the control points the design system uses.
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number): number => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number): number => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number): number => (3 * ax * t + 2 * bx) * t + cx;

  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i += 1) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-6) return sampleY(t);
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 24; i += 1) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sampleY(t);
  };
}

/** --ease-inout (.65, 0, .35, 1): the morph between sphere and torus. */
export const easeInOut = cubicBezier(0.65, 0, 0.35, 1);

// ───────── Voice ─────────

/** Attack 40 ms, release 220 ms (§2.7): quick to rise so a word is seen at once, slow to fall so it is calm. */
export const LEVEL_ATTACK_MS = 40;
export const LEVEL_RELEASE_MS = 220;

/** Exponential smoothing of the microphone level towards `target` over `dtMs`. */
export function smoothLevel(
  current: number,
  target: number,
  dtMs: number,
  attackMs = LEVEL_ATTACK_MS,
  releaseMs = LEVEL_RELEASE_MS,
): number {
  const goal = clamp01(target);
  if (dtMs <= 0) return clamp01(current);
  const tau = goal > current ? attackMs : releaseMs;
  const k = tau <= 0 ? 1 : 1 - Math.exp(-dtMs / tau);
  return clamp01(current + (goal - current) * k);
}

/** The biggest radial shift of a dot at full level: 18 % of the radius (§2.7). */
export const MAX_DISPLACEMENT = 0.18;

/**
 * Radial shift (fraction of the radius, 0..MAX_DISPLACEMENT) of one dot. A swell that follows the level plus
 * a ripple that runs over the surface: `phase` is per dot and spatially coherent, so it reads as a wave.
 */
export function voiceDisplacement(level: number, phase: number, timeMs: number, max = MAX_DISPLACEMENT): number {
  const ripple = 0.5 + 0.5 * Math.sin(phase + timeMs * 0.011);
  return max * clamp01(level) * (0.35 + 0.65 * ripple);
}

/** Level and rise that throw a dot off the surface: a peak of the voice, not its hum. */
export const SPARK_LEVEL = 0.5;
export const SPARK_RISE = 0.08;
export const SPARK_COOLDOWN_MS = 110;
export const SPARK_LIFE_MS = 640;
export const SPARK_MAX = 18;

export function shouldSpawnSpark(level: number, previous: number, sinceLastMs: number): boolean {
  return level >= SPARK_LEVEL && level - previous >= SPARK_RISE && sinceLastMs >= SPARK_COOLDOWN_MS;
}

/** Distance (in radii) and opacity of a spark `ageMs` after it left the surface; null once it is gone. */
export function sparkAt(ageMs: number, speed = 0.55): { radius: number; alpha: number } | null {
  if (ageMs < 0 || ageMs >= SPARK_LIFE_MS) return null;
  const p = ageMs / SPARK_LIFE_MS;
  const eased = 1 - (1 - p) * (1 - p); // fast out, slow in
  return { radius: 1 + speed * 0.5 * eased, alpha: (1 - p) * (1 - p) };
}

/**
 * The "done" gesture: the dots draw together and release in a flash (§2.11, 600 ms).
 * `scale` dips to 0.88 and returns; `flash` rises and falls with the same beat.
 */
export const DONE_MS = 600;
export function doneCurve(ageMs: number): { scale: number; flash: number } {
  const p = clamp01(ageMs / DONE_MS);
  const beat = Math.sin(Math.PI * p);
  return { scale: 1 - 0.12 * beat, flash: beat * beat };
}

// ───────── Sizing ─────────

/** Points for an orb of `size` CSS px when the full 220 px orb gets `maxPoints`: smaller orbs need far fewer. */
export function pointsForSize(size: number, maxPoints: number): number {
  if (maxPoints <= 0 || size <= 0) return 0;
  const share = Math.pow(clamp(size / 220, 0, 1), 1.5);
  return Math.min(maxPoints, Math.max(48, Math.round(maxPoints * share)));
}

/** The backing store is at most 2x the CSS size, whatever the device pixel ratio (§3.4). */
export function backingScale(dpr: number): number {
  return clamp(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, 1, 2);
}

/** Dot radius scale: dots shrink with the orb, but not below 45 % or they vanish on a 24 px orb. */
export function dotScale(size: number): number {
  return clamp(size / 220, 0.45, 1);
}
