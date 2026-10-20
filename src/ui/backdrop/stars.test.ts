import { beforeEach, describe, expect, it } from 'vitest';
import { stubCanvas } from '../testUtils';
import { GRAIN_SIZE, createRandom, generateStars, grainPixels, grainTileUrl, starTileSvg, twinkleAlpha } from './stars';
import { moodStep } from './mood';

describe('createRandom', () => {
  it('is deterministic for a seed and stays in [0, 1)', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    const values = Array.from({ length: 200 }, () => a());
    expect(values).toEqual(Array.from({ length: 200 }, () => b()));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(createRandom(43)()).not.toBe(createRandom(42)());
  });
});

describe('generateStars', () => {
  it('returns the requested number of stars inside their documented ranges', () => {
    const stars = generateStars(60, 7);
    expect(stars).toHaveLength(60);
    for (const star of stars) {
      expect(star.x).toBeGreaterThanOrEqual(0);
      expect(star.x).toBeLessThan(1);
      expect(star.r).toBeGreaterThanOrEqual(0.5);
      expect(star.r).toBeLessThanOrEqual(1.6);
      expect(star.a).toBeGreaterThanOrEqual(0.25);
      expect(star.a).toBeLessThanOrEqual(0.9);
    }
  });

  it('gives the same sky every time and none for a non-positive count', () => {
    expect(generateStars(10, 1)).toEqual(generateStars(10, 1));
    expect(generateStars(0, 1)).toEqual([]);
    expect(generateStars(-5, 1)).toEqual([]);
  });
});

describe('twinkleAlpha', () => {
  it('breathes between 55 % and 100 % of the base opacity', () => {
    const star = { a: 0.8, period: 4000, phase: 0 };
    const samples = Array.from({ length: 80 }, (_, i) => twinkleAlpha(star, i * 100));
    expect(Math.max(...samples)).toBeLessThanOrEqual(0.8 + 1e-9);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.8 * 0.55 - 1e-9);
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.1);
  });
});

describe('starTileSvg', () => {
  it('draws the requested number of points inside the tile, away from the edge', () => {
    const svg = starTileSvg(360, 36, 5);
    const circles = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)];
    expect(circles).toHaveLength(36);
    for (const [, x, y] of circles) {
      expect(Number(x)).toBeGreaterThanOrEqual(6);
      expect(Number(x)).toBeLessThanOrEqual(354);
      expect(Number(y)).toBeGreaterThanOrEqual(6);
      expect(Number(y)).toBeLessThanOrEqual(354);
    }
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});

describe('grain', () => {
  beforeEach(stubCanvas);

  it('builds a 128 px RGBA tile with black and white specks of varying alpha', () => {
    const data = grainPixels(GRAIN_SIZE, 1);
    expect(data).toHaveLength(GRAIN_SIZE * GRAIN_SIZE * 4);
    let white = 0;
    let black = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 255) white++;
      else if (data[i] === 0) black++;
      expect(data[i + 3]!).toBeLessThan(200);
    }
    expect(white + black).toBe(GRAIN_SIZE * GRAIN_SIZE);
    // balanced, so the average brightness does not shift
    expect(Math.abs(white - black) / (GRAIN_SIZE * GRAIN_SIZE)).toBeLessThan(0.05);
    expect(grainPixels(GRAIN_SIZE, 1)).toEqual(data);
  });

  it('returns an empty url where canvas is missing instead of throwing', () => {
    expect(grainTileUrl()).toBe('');
  });
});

describe('moodStep', () => {
  it.each([
    [-1, -3],
    [-0.67, -2],
    [-0.34, -1],
    [0, 0],
    [0.34, 1],
    [0.67, 2],
    [1, 3],
    [5, 3],
    [-9, -3],
  ])('maps %s to step %s', (mood, step) => {
    expect(moodStep(mood)).toBe(step);
  });

  it('treats a missing or broken mood as neutral', () => {
    expect(moodStep(null)).toBe(0);
    expect(moodStep(undefined)).toBe(0);
    expect(moodStep(Number.NaN)).toBe(0);
    expect(Object.is(moodStep(-0.01), 0)).toBe(true); // never -0
  });
});
