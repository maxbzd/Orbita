import { describe, expect, it } from 'vitest';
import { ORB_PALETTES, SATURATION_STEPS, desaturateRgb, parseHex, saturationStep } from './palette';
import { LEVEL_STALE_MS, readLevel } from './useOrbLevel';

const luminance = (hex: string): number => {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('orb palettes', () => {
  it('night is the palette of the spec and of the --orb-* tokens', () => {
    expect(ORB_PALETTES.night).toMatchObject({ core: '#E8EEFF', edge: '#8B6CFF', rare: '#5B8CFF' });
  });

  it('every dot colour is a visible shape against its sky (WCAG 1.4.11, 3:1)', () => {
    for (const key of ['core', 'edge', 'rare'] as const) {
      expect(contrast(ORB_PALETTES.night[key], '#07080F')).toBeGreaterThanOrEqual(3);
    }
    // On paper the limb colour is only ever drawn faint (alpha follows depth), the facing dots must be strong.
    expect(contrast(ORB_PALETTES.dawn.core, '#F6F3EC')).toBeGreaterThanOrEqual(7);
    expect(contrast(ORB_PALETTES.dawn.rare, '#F6F3EC')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(ORB_PALETTES.dawn.edge, '#F6F3EC')).toBeGreaterThanOrEqual(3);
  });

  it('keeps the flash readable as "ok" in both themes', () => {
    expect(contrast(ORB_PALETTES.night.ok, '#07080F')).toBeGreaterThanOrEqual(7);
    expect(contrast(ORB_PALETTES.dawn.ok, '#F6F3EC')).toBeGreaterThanOrEqual(3);
  });
});

describe('desaturation', () => {
  it('leaves the colour alone at 1, makes it grey at 0 and sits in between at .6', () => {
    expect(desaturateRgb('#8B6CFF', 1)).toBe('139, 108, 255');
    const [r, g, b] = desaturateRgb('#8B6CFF', 0).split(', ').map(Number) as [number, number, number];
    expect(Math.abs(r - g)).toBeLessThanOrEqual(1);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(1);
    const [, , blue] = desaturateRgb('#8B6CFF', 0.6).split(', ').map(Number) as [number, number, number];
    expect(blue).toBeLessThan(255);
    expect(blue).toBeGreaterThan(r);
  });

  it('snaps saturation to the pre-rendered steps', () => {
    expect(SATURATION_STEPS).toEqual([1, 0.6, 0.35]);
    expect(saturationStep(0.97)).toBe(1);
    expect(saturationStep(0.7)).toBe(0.6);
    expect(saturationStep(0.4)).toBe(0.35);
    expect(saturationStep(0)).toBe(0.35);
  });

  it('parses short hex', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
  });
});

describe('readLevel', () => {
  it('clamps numbers and refs', () => {
    expect(readLevel(0.4)).toBe(0.4);
    expect(readLevel(3)).toBe(1);
    expect(readLevel(-1)).toBe(0);
    expect(readLevel(undefined)).toBe(0);
    expect(readLevel({ current: 0.7 })).toBe(0.7);
  });

  it('treats a ref that has not been written for half a second as silence', () => {
    const ref = { current: 0.8, updatedAt: 1000 };
    expect(readLevel(ref, 1000 + LEVEL_STALE_MS - 1)).toBe(0.8);
    expect(readLevel(ref, 1000 + LEVEL_STALE_MS + 1)).toBe(0);
  });
});
