import { describe, expect, it } from 'vitest';
import { hexToOklch, mixOklch, oklchToHex, parseHex, toHex } from './color';

describe('colour conversion', () => {
  it('round-trips hex through OKLCH', () => {
    for (const hex of ['#7a5bd6', '#5b6fe0', '#4f8df0', '#bfe3ee', '#a9d86b', '#f5cf4f', '#f7a22e', '#000000', '#ffffff']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex);
    }
  });

  it('knows the lightness of black and white', () => {
    expect(hexToOklch('#000000').l).toBeCloseTo(0, 3);
    expect(hexToOklch('#ffffff').l).toBeCloseTo(1, 3);
  });

  it('reads short hex and rejects junk', () => {
    expect(toHex(parseHex('#fff'))).toBe('#ffffff');
    expect(() => parseHex('red')).toThrow(RangeError);
  });
});

describe('mixOklch', () => {
  it('returns the ends exactly', () => {
    expect(mixOklch('#7a5bd6', '#f7a22e', 0)).toBe('#7a5bd6');
    expect(mixOklch('#7a5bd6', '#f7a22e', 1)).toBe('#f7a22e');
  });

  it('keeps lightness between the ends and moves smoothly', () => {
    const a = hexToOklch('#4f8df0').l;
    const b = hexToOklch('#bfe3ee').l;
    const mid = hexToOklch(mixOklch('#4f8df0', '#bfe3ee', 0.5)).l;
    expect(mid).toBeGreaterThan(Math.min(a, b));
    expect(mid).toBeLessThan(Math.max(a, b));
  });

  it('takes the short way round the hue circle', () => {
    // Red-ish (hue ~29°) to magenta-ish (hue ~330°): the midpoint stays on the red/magenta side, not green.
    const mid = hexToOklch(mixOklch('#ff4d4d', '#ff4dc8', 0.5));
    expect(mid.h > 330 || mid.h < 30).toBe(true);
  });

  it('lends a grey the other colour hue', () => {
    const mid = hexToOklch(mixOklch('#808080', '#4f8df0', 0.5));
    const target = hexToOklch('#4f8df0').h;
    expect(Math.abs(mid.h - target)).toBeLessThan(2);
  });
});
