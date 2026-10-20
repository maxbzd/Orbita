import { describe, expect, it } from 'vitest';
import {
  DONE_MS,
  GOLDEN_ANGLE,
  MAX_DISPLACEMENT,
  SPARK_LIFE_MS,
  TORUS_MAJOR,
  TORUS_MINOR,
  applyRotation,
  backingScale,
  cubicBezier,
  depthAlpha,
  depthRadius,
  doneCurve,
  dotScale,
  easeInOut,
  fibonacciSphere,
  morphPositions,
  mulberry32,
  pointsForSize,
  project,
  rotationYawPitch,
  shouldSpawnSpark,
  smoothLevel,
  sparkAt,
  torusTargets,
  tubeAngleForShare,
  voiceDisplacement,
} from './geometry';

const norm = (p: Float32Array, i: number): number => Math.hypot(p[i * 3] ?? 0, p[i * 3 + 1] ?? 0, p[i * 3 + 2] ?? 0);

describe('fibonacciSphere', () => {
  it('uses the golden angle from the spec', () => {
    expect(GOLDEN_ANGLE).toBeCloseTo(2.399963, 6);
  });

  it('puts every point on the unit sphere', () => {
    const pts = fibonacciSphere(1200);
    expect(pts).toHaveLength(3600);
    for (let i = 0; i < 1200; i += 1) expect(norm(pts, i)).toBeCloseTo(1, 5);
  });

  it('follows y = 1 - 2(i + .5)/N from the top down', () => {
    const n = 100;
    const pts = fibonacciSphere(n);
    expect(pts[1]).toBeCloseTo(1 - 1 / n, 6);
    expect(pts[(n - 1) * 3 + 1]).toBeCloseTo(-1 + 1 / n, 6);
    expect(pts[50 * 3 + 1]).toBeCloseTo(1 - 101 / n, 6);
  });

  it('spreads evenly: the centroid is near the origin and the hemispheres are balanced', () => {
    const n = 1200;
    const pts = fibonacciSphere(n);
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let front = 0;
    for (let i = 0; i < n; i += 1) {
      sx += pts[i * 3] ?? 0;
      sy += pts[i * 3 + 1] ?? 0;
      sz += pts[i * 3 + 2] ?? 0;
      if ((pts[i * 3 + 2] ?? 0) > 0) front += 1;
    }
    expect(Math.abs(sx / n)).toBeLessThan(0.01);
    expect(Math.abs(sy / n)).toBeLessThan(0.001);
    expect(Math.abs(sz / n)).toBeLessThan(0.01);
    expect(Math.abs(front - n / 2)).toBeLessThan(n * 0.02);
  });

  it('handles empty and fractional counts', () => {
    expect(fibonacciSphere(0)).toHaveLength(0);
    expect(fibonacciSphere(-5)).toHaveLength(0);
    expect(fibonacciSphere(2.9)).toHaveLength(6);
  });
});

describe('torus', () => {
  const sphere = fibonacciSphere(600);
  const torus = torusTargets(sphere);

  it('lands every point on the torus with radii 0.62 and 0.28', () => {
    for (let i = 0; i < 600; i += 1) {
      const x = torus[i * 3] ?? 0;
      const y = torus[i * 3 + 1] ?? 0;
      const z = torus[i * 3 + 2] ?? 0;
      const ring = Math.hypot(x, z);
      expect(Math.hypot(ring - TORUS_MAJOR, y)).toBeCloseTo(TORUS_MINOR, 5);
    }
  });

  it('keeps the azimuth of each point, so a point slides inside its own meridian plane', () => {
    for (const i of [0, 7, 123, 300, 599]) {
      const a = Math.atan2(sphere[i * 3 + 2] ?? 0, sphere[i * 3] ?? 0);
      const b = Math.atan2(torus[i * 3 + 2] ?? 0, torus[i * 3] ?? 0);
      expect(Math.cos(a - b)).toBeCloseTo(1, 4);
    }
  });

  it('inverts the surface share: equal shares of area, not of angle', () => {
    const G = (psi: number): number => (TORUS_MAJOR * psi + TORUS_MINOR * (1 - Math.cos(psi))) / (2 * Math.PI * TORUS_MAJOR);
    for (const share of [0, 0.1, 0.37, 0.5, 0.82, 1]) {
      expect(G(tubeAngleForShare(share))).toBeCloseTo(share, 6);
    }
  });

  it('is area-uniform: as many points on the outer half of the tube as expected from its area', () => {
    // outer half (ring > R) has area (R + 2r/pi) / (2R) of the total
    let outer = 0;
    for (let i = 0; i < 600; i += 1) if (Math.hypot(torus[i * 3] ?? 0, torus[i * 3 + 2] ?? 0) > TORUS_MAJOR) outer += 1;
    const expected = (TORUS_MAJOR + (2 * TORUS_MINOR) / Math.PI) / (2 * TORUS_MAJOR);
    expect(outer / 600).toBeCloseTo(expected, 1);
  });

  it('runs the tube once from top over the outer side, bottom and inner side back to the top', () => {
    const y = (i: number): number => torus[i * 3 + 1] ?? 0;
    const ring = (i: number): number => Math.hypot(torus[i * 3] ?? 0, torus[i * 3 + 2] ?? 0);
    expect(y(0)).toBeGreaterThan(TORUS_MINOR * 0.95); // starts on top
    expect(ring(Math.round(600 * 0.32))).toBeGreaterThan(TORUS_MAJOR + TORUS_MINOR * 0.95); // outer equator
    expect(y(Math.round(600 * 0.5))).toBeLessThan(0); // underneath
    expect(ring(Math.round(600 * 0.82))).toBeLessThan(TORUS_MAJOR - TORUS_MINOR * 0.9); // inner side
    expect(y(599)).toBeGreaterThan(TORUS_MINOR * 0.95); // back on top
  });
});

describe('morphPositions', () => {
  const a = fibonacciSphere(64);
  const b = torusTargets(a);
  const out = new Float32Array(a.length);

  it('is the sphere at t = 0 and the torus at t = 1', () => {
    expect(Array.from(morphPositions(a, b, 0, out))).toEqual(Array.from(a));
    const end = morphPositions(a, b, 1, out);
    for (let i = 0; i < b.length; i += 1) expect(end[i]).toBeCloseTo(b[i] ?? 0, 6);
  });

  it('is linear in between and clamps t', () => {
    const mid = morphPositions(a, b, 0.5, out);
    for (let i = 0; i < a.length; i += 1) expect(mid[i]).toBeCloseTo(((a[i] ?? 0) + (b[i] ?? 0)) / 2, 6);
    expect(Array.from(morphPositions(a, b, -3, out))).toEqual(Array.from(a));
    const over = morphPositions(a, b, 7, out);
    expect(over[0]).toBeCloseTo(b[0] ?? 0, 6);
  });

  it('never leaves the unit ball on the way', () => {
    for (const t of [0.1, 0.3, 0.6, 0.9]) {
      const p = morphPositions(a, b, t, out);
      for (let i = 0; i < 64; i += 1) expect(norm(p, i)).toBeLessThanOrEqual(1.0001);
    }
  });
});

describe('rotation and projection', () => {
  const out = new Float64Array(3);

  it('is the identity for zero angles', () => {
    applyRotation(rotationYawPitch(0, 0), 0.3, -0.5, 0.8, out);
    expect(Array.from(out)).toEqual([0.3, -0.5, 0.8].map((v) => expect.closeTo(v, 12)));
  });

  it('preserves length for any angles', () => {
    for (const [yaw, pitch] of [[0.7, 0.3], [3.1, -1.2], [6, 1.5]] as const) {
      applyRotation(rotationYawPitch(yaw, pitch), 0.2, 0.9, -0.4, out);
      expect(Math.hypot(out[0] ?? 0, out[1] ?? 0, out[2] ?? 0)).toBeCloseTo(Math.hypot(0.2, 0.9, 0.4), 10);
    }
  });

  it('yaw turns about the vertical axis: a quarter turn brings the right side to the back', () => {
    applyRotation(rotationYawPitch(Math.PI / 2, 0), 1, 0, 0, out);
    expect(out[0]).toBeCloseTo(0, 10);
    expect(out[2]).toBeCloseTo(-1, 10);
    applyRotation(rotationYawPitch(Math.PI / 2, 0), 0, 1, 0, out);
    expect(out[1]).toBeCloseTo(1, 10); // the axis itself does not move
  });

  it('positive pitch tilts the north pole towards the viewer', () => {
    applyRotation(rotationYawPitch(0, 0.5), 0, 1, 0, out);
    expect(out[2]).toBeCloseTo(Math.sin(0.5), 10);
    expect(out[1]).toBeCloseTo(Math.cos(0.5), 10);
  });

  it('projects orthographically with screen y pointing down', () => {
    expect(project(0, 0, 80, 110, 110)).toEqual({ x: 110, y: 110 });
    expect(project(1, 0, 80, 110, 110)).toEqual({ x: 190, y: 110 });
    expect(project(0, 1, 80, 110, 110)).toEqual({ x: 110, y: 30 });
    expect(project(-0.5, -0.5, 100, 0, 0)).toEqual({ x: -50, y: 50 });
  });
});

describe('depth', () => {
  it('follows .25 + .75 z on the front side', () => {
    expect(depthAlpha(0)).toBeCloseTo(0.25, 10);
    expect(depthAlpha(1)).toBeCloseTo(1, 10);
    expect(depthAlpha(0.5)).toBeCloseTo(0.625, 10);
  });

  it('caps at 1 for dots pushed past the surface', () => {
    expect(depthAlpha(1.2)).toBe(1);
  });

  it('fades the far side continuously from the limb to nothing', () => {
    expect(depthAlpha(-0.0001)).toBeCloseTo(0.25, 3);
    expect(depthAlpha(-0.5)).toBeLessThan(depthAlpha(-0.2));
    expect(depthAlpha(-1)).toBe(0);
    expect(depthAlpha(-3)).toBe(0);
  });

  it('grows the dot radius as 1.2 + 1.2 z, never thinner than .5', () => {
    expect(depthRadius(1)).toBeCloseTo(2.4, 10);
    expect(depthRadius(0)).toBeCloseTo(1.2, 10);
    expect(depthRadius(-1)).toBe(0.5);
  });
});

describe('easing', () => {
  it('cubic-bezier hits both ends and is monotonic', () => {
    let prev = -1;
    for (let i = 0; i <= 50; i += 1) {
      const v = easeInOut(i / 50);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
  });

  it('--ease-inout is symmetric: f(t) + f(1 - t) = 1, and slow at the ends', () => {
    for (const t of [0.1, 0.25, 0.4]) expect(easeInOut(t) + easeInOut(1 - t)).toBeCloseTo(1, 4);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 4);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
  });

  it('matches the identity for the linear curve', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    for (const t of [0.2, 0.5, 0.9]) expect(linear(t)).toBeCloseTo(t, 4);
  });
});

describe('smoothLevel', () => {
  it('rises faster than it falls: attack 40 ms, release 220 ms', () => {
    const up = smoothLevel(0, 1, 40);
    const down = smoothLevel(1, 0, 40);
    expect(up).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(1 - down).toBeLessThan(up);
    expect(down).toBeGreaterThan(0.8);
  });

  it('settles on the target and ignores nonsense', () => {
    let v = 0;
    for (let i = 0; i < 60; i += 1) v = smoothLevel(v, 0.7, 16);
    expect(v).toBeCloseTo(0.7, 3);
    expect(smoothLevel(0.4, 0.9, 0)).toBe(0.4);
    expect(smoothLevel(0, 5, 1000)).toBeLessThanOrEqual(1);
    expect(smoothLevel(0.5, Number.NaN, 100)).toBeLessThan(0.5);
  });
});

describe('voice', () => {
  it('never shifts a dot more than 18 % of the radius and is zero in silence', () => {
    expect(voiceDisplacement(0, 1.3, 4000)).toBe(0);
    let max = 0;
    for (let t = 0; t < 2000; t += 7) max = Math.max(max, voiceDisplacement(1, (t % 13) * 0.4, t));
    expect(max).toBeLessThanOrEqual(MAX_DISPLACEMENT);
    expect(max).toBeGreaterThan(MAX_DISPLACEMENT * 0.95);
    expect(voiceDisplacement(7, 0, 0)).toBeLessThanOrEqual(MAX_DISPLACEMENT);
  });

  it('is a wave: neighbouring phases are shifted at the same moment', () => {
    expect(voiceDisplacement(0.8, 0, 100)).not.toBeCloseTo(voiceDisplacement(0.8, Math.PI, 100), 3);
  });

  it('throws a spark only on a loud, quick rise, and not too often', () => {
    expect(shouldSpawnSpark(0.8, 0.5, 500)).toBe(true);
    expect(shouldSpawnSpark(0.3, 0.1, 500)).toBe(false); // too quiet
    expect(shouldSpawnSpark(0.8, 0.79, 500)).toBe(false); // no rise: a held note
    expect(shouldSpawnSpark(0.8, 0.5, 30)).toBe(false); // cooldown
  });

  it('a spark flies out and fades within its life', () => {
    const start = sparkAt(0);
    const mid = sparkAt(SPARK_LIFE_MS / 2);
    expect(start?.radius).toBeCloseTo(1, 6);
    expect(start?.alpha).toBeCloseTo(1, 6);
    expect(mid && start && mid.radius > start.radius).toBe(true);
    expect(mid && start && mid.alpha < start.alpha).toBe(true);
    expect(sparkAt(SPARK_LIFE_MS)).toBeNull();
    expect(sparkAt(-1)).toBeNull();
  });
});

describe('done', () => {
  it('draws together and flashes mid-way, and is back to rest at the end', () => {
    expect(doneCurve(0)).toEqual({ scale: 1, flash: 0 });
    const mid = doneCurve(DONE_MS / 2);
    expect(mid.scale).toBeCloseTo(0.88, 6);
    expect(mid.flash).toBeCloseTo(1, 6);
    const end = doneCurve(DONE_MS * 3);
    expect(end.scale).toBeCloseTo(1, 6);
    expect(end.flash).toBeCloseTo(0, 6);
  });
});

describe('sizing', () => {
  it('gives a smaller orb fewer points but never fewer than 48', () => {
    expect(pointsForSize(220, 1200)).toBe(1200);
    expect(pointsForSize(500, 1200)).toBe(1200);
    const p68 = pointsForSize(68, 1200);
    const p40 = pointsForSize(40, 1200);
    expect(p68).toBeGreaterThan(p40);
    expect(p68).toBeLessThan(400);
    expect(pointsForSize(24, 1200)).toBe(48);
    expect(pointsForSize(220, 600)).toBe(600);
  });

  it('gives no points where the budget is zero (the CSS sphere is used)', () => {
    expect(pointsForSize(220, 0)).toBe(0);
    expect(pointsForSize(0, 1200)).toBe(0);
  });

  it('caps the backing store at 2x the CSS size', () => {
    expect(backingScale(1)).toBe(1);
    expect(backingScale(1.5)).toBe(1.5);
    expect(backingScale(3)).toBe(2);
    expect(backingScale(0)).toBe(1);
    expect(backingScale(Number.NaN)).toBe(1);
  });

  it('shrinks dots with the orb, down to 45 %', () => {
    expect(dotScale(220)).toBe(1);
    expect(dotScale(24)).toBe(0.45);
    expect(dotScale(110)).toBe(0.5);
  });
});

describe('mulberry32', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 20; i += 1) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});
