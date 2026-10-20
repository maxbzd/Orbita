import { describe, expect, it } from 'vitest';
import { TAU, angleOf, arcPath, polar, round, sectorPath, slotAt, wrapTau } from './polar';

describe('polar geometry (clockwise from the top)', () => {
  it('puts angle 0 on top, a quarter turn on the right, a half turn at the bottom', () => {
    const top = polar(150, 150, 100, 0);
    expect(top.x).toBeCloseTo(150);
    expect(top.y).toBeCloseTo(50);
    const right = polar(150, 150, 100, Math.PI / 2);
    expect(right.x).toBeCloseTo(250);
    expect(right.y).toBeCloseTo(150);
    const bottom = polar(150, 150, 100, Math.PI);
    expect(bottom.x).toBeCloseTo(150);
    expect(bottom.y).toBeCloseTo(250);
  });

  it('angleOf is the inverse of polar', () => {
    for (const theta of [-3, -1.2, 0, 0.7, 2.5]) {
      const p = polar(10, 20, 40, theta);
      expect(angleOf(10, 20, p.x, p.y)).toBeCloseTo(theta);
    }
  });

  it('wraps angles into one turn', () => {
    expect(wrapTau(-0.5)).toBeCloseTo(TAU - 0.5);
    expect(wrapTau(TAU + 1)).toBeCloseTo(1);
  });

  it('rounds without negative zero', () => {
    expect(Object.is(round(-0.0001), 0)).toBe(true);
    expect(round(1.23456, 2)).toBe(1.23);
  });
});

describe('arcPath', () => {
  it('draws nothing for an empty sweep', () => {
    expect(arcPath(0, 0, 10, 1, 1)).toBe('');
    expect(arcPath(0, 0, 10, 2, 1)).toBe('');
  });

  it('sets the large-arc flag past half a turn and always sweeps clockwise', () => {
    expect(arcPath(0, 0, 10, 0, 1)).toMatch(/A10 10 0 0 1 /);
    expect(arcPath(0, 0, 10, 0, 4)).toMatch(/A10 10 0 1 1 /);
  });

  it('splits a full circle in two arcs', () => {
    expect(arcPath(0, 0, 10, 0, TAU).match(/A/g)).toHaveLength(2);
  });
});

describe('sectorPath', () => {
  it('is closed and uses both radii', () => {
    const d = sectorPath(0, 0, 8, 12, 0, 1);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toContain('A12 12');
    expect(d).toContain('A8 8');
  });
});

describe('slotAt', () => {
  it('maps pointer angles to equal slots centred on the start angle', () => {
    // 7 slots, the first centred on the top.
    expect(slotAt(0, 7)).toBe(0);
    expect(slotAt(0.1, 7)).toBe(0);
    expect(slotAt(TAU / 7, 7)).toBe(1);
    expect(slotAt(-0.1, 7)).toBe(0);
    expect(slotAt(-TAU / 7, 7)).toBe(6);
    expect(slotAt(Math.PI, 7)).toBe(4);
  });
});
