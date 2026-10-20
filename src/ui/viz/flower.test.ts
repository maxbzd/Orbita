import { describe, expect, it } from 'vitest';
import { FLOWER_POINTS, flowerPath, flowerPoints, flowerRadius, flowerReach, flowerShape, levelToValue, sharpCos } from './flower';

describe('mood-flower formula (docs §3.6)', () => {
  it('uses k = 8 and a = 0.30·|v|/3 for negative moods', () => {
    expect(flowerShape(-3)).toMatchObject({ k: 8, a: 0.3, profile: 'sharp' });
    expect(flowerShape(-2).a).toBeCloseTo(0.2);
    expect(flowerShape(-1).a).toBeCloseTo(0.1);
  });

  it('is a plain circle at zero', () => {
    expect(flowerShape(0)).toMatchObject({ a: 0, profile: 'circle' });
    for (const theta of [0, 1, 2.5, 4]) expect(flowerRadius(theta, 0)).toBe(1);
  });

  it('uses k = 5 and a = 0.06 + 0.16·v/3 at the whole positive steps', () => {
    expect(flowerShape(1)).toMatchObject({ k: 5, profile: 'cosine' });
    expect(flowerShape(1).a).toBeCloseTo(0.06 + 0.16 / 3);
    expect(flowerShape(2).a).toBeCloseTo(0.06 + (0.16 * 2) / 3);
    expect(flowerShape(3).a).toBeCloseTo(0.22);
  });

  it('evaluates the contour at characteristic angles', () => {
    // v = -3: at θ = 0 the sharp cosine is 1 -> r = 1.3; at θ = π/16 (k·θ = π/2) it is 0 -> r = 1.
    expect(flowerRadius(0, -3)).toBeCloseTo(1.3);
    expect(flowerRadius(Math.PI / 16, -3)).toBeCloseTo(1, 6);
    // 8 lobes: the same radius every 2π/8
    expect(flowerRadius(0.3, -3)).toBeCloseTo(flowerRadius(0.3 + (2 * Math.PI) / 8, -3), 9);
    // v = +3: cos(5θ); θ = 0 -> 1.22; θ = π/5 -> 0.78
    expect(flowerRadius(0, 3)).toBeCloseTo(1.22);
    expect(flowerRadius(Math.PI / 5, 3)).toBeCloseTo(0.78);
    // v = +1 is a gently rounded pentagon: amplitude 0.113
    expect(flowerRadius(0, 1)).toBeCloseTo(1 + 0.06 + 0.16 / 3);
  });

  it('sharpens the cosine as sign(cos)·|cos|^0.6', () => {
    expect(sharpCos(0)).toBe(1);
    expect(sharpCos(Math.PI)).toBe(-1);
    expect(sharpCos(Math.PI / 3)).toBeCloseTo(0.5 ** 0.6);
    expect(sharpCos(Math.PI / 2)).toBeCloseTo(0, 6);
  });

  it('passes through the circle continuously while the value goes from -1 to +1', () => {
    const samples = [-1, -0.5, -0.1, -0.01, 0, 0.01, 0.1, 0.5, 1];
    const amplitudes = samples.map((v) => flowerShape(v).a);
    // amplitude falls to 0 at the circle and rises again; no jump anywhere
    for (let i = 1; i < amplitudes.length; i++) {
      const step = Math.abs(amplitudes[i]! - amplitudes[i - 1]!);
      const dv = Math.abs(samples[i]! - samples[i - 1]!);
      expect(step).toBeLessThanOrEqual(dv * 0.2 + 1e-9);
    }
    expect(flowerShape(0.001).a).toBeLessThan(0.001);
    expect(flowerShape(-0.001).a).toBeLessThan(0.001);
    // and the contour itself barely moves across zero
    const left = flowerPoints(-0.001, { size: 120 });
    const right = flowerPoints(0.001, { size: 120 });
    for (let i = 0; i < left.length; i++) {
      expect(Math.hypot(left[i]!.x - right[i]!.x, left[i]!.y - right[i]!.y)).toBeLessThan(0.15);
    }
  });

  it('draws 96 points by default and never leaves its box', () => {
    for (const v of [-3, -2, -1, 0, 1, 2, 3, -0.4, 1.7]) {
      const points = flowerPoints(v, { size: 120 });
      expect(points).toHaveLength(FLOWER_POINTS);
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(120);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(120);
      }
    }
  });

  it('fits the biggest lobe to the box (96 % of the half-size)', () => {
    const points = flowerPoints(-3, { size: 100 });
    const farthest = Math.max(...points.map((p) => Math.hypot(p.x - 50, p.y - 50)));
    expect(farthest).toBeCloseTo(48, 0);
    expect(flowerReach(3)).toBeCloseTo(1.22);
  });

  it('starts straight up so petals point to the top', () => {
    const [first] = flowerPoints(3, { size: 120 });
    expect(first!.x).toBeCloseTo(60);
    expect(first!.y).toBeLessThan(10);
  });

  it('makes a closed path and clamps out-of-range values', () => {
    expect(flowerPath(2)).toMatch(/^M.*Z$/);
    expect(flowerPath(99)).toBe(flowerPath(3));
    expect(flowerPath(Number.NaN)).toBe(flowerPath(0));
  });

  it('maps the continuous level -1…+1 onto the value -3…+3', () => {
    expect(levelToValue(-1)).toBe(-3);
    expect(levelToValue(0)).toBe(0);
    expect(levelToValue(0.5)).toBe(1.5);
    expect(levelToValue(7)).toBe(3);
  });
});
