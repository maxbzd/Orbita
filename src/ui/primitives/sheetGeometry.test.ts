import { describe, expect, it } from 'vitest';
import { DEFAULT_SNAPS, clampDrag, clampIndex, resolveRelease, snapShift, stepSnap } from './sheetGeometry';

const VIEWPORT = 800;
const base = { snaps: DEFAULT_SNAPS, viewport: VIEWPORT, dismissible: true, velocity: 0 };

describe('resolveRelease', () => {
  it('stays on the stop it started from after a tiny drag', () => {
    expect(resolveRelease({ ...base, index: 1, offset: 12 })).toEqual({ kind: 'snap', index: 1 });
    expect(resolveRelease({ ...base, index: 1, offset: -12 })).toEqual({ kind: 'snap', index: 1 });
  });

  it('settles on the nearest stop when dragged there slowly', () => {
    // 70 % of 800 = 560 px; dragging up by 180 px reaches 740 px = 92.5 %
    expect(resolveRelease({ ...base, index: 1, offset: -180 })).toEqual({ kind: 'snap', index: 2 });
    // dragging down by 240 px leaves 320 px = 40 %
    expect(resolveRelease({ ...base, index: 1, offset: 240 })).toEqual({ kind: 'snap', index: 0 });
  });

  it('lets a flick carry the sheet to the next stop', () => {
    // an upward flick: -60 px at -1 px/ms projects 180 px further = 70 %, the middle stop
    expect(resolveRelease({ ...base, index: 0, offset: -60, velocity: -1 })).toEqual({ kind: 'snap', index: 1 });
    // twice as fast reaches the top stop
    expect(resolveRelease({ ...base, index: 0, offset: -60, velocity: -2 })).toEqual({ kind: 'snap', index: 2 });
  });

  it('closes when pulled well below the lowest stop', () => {
    // 40 % = 320 px; a drag of 260 px leaves 60 px, under 55 % of the lowest stop
    expect(resolveRelease({ ...base, index: 0, offset: 260 })).toEqual({ kind: 'close' });
  });

  it('closes on a fast downward flick from the lowest stop even over a short distance', () => {
    expect(resolveRelease({ ...base, index: 0, offset: 40, velocity: 1.2 })).toEqual({ kind: 'close' });
  });

  it('never closes when it is not dismissible: it rests on the lowest stop', () => {
    expect(resolveRelease({ ...base, dismissible: false, index: 0, offset: 300, velocity: 2 })).toEqual({ kind: 'snap', index: 0 });
  });

  it('copes with a degenerate viewport or an empty list of stops', () => {
    expect(resolveRelease({ ...base, viewport: 0, index: 1, offset: 50 })).toEqual({ kind: 'snap', index: 0 });
    expect(resolveRelease({ ...base, snaps: [], index: 0, offset: 50 })).toEqual({ kind: 'snap', index: 0 });
  });
});

describe('clampDrag', () => {
  it('follows the finger within the allowed range', () => {
    expect(clampDrag(50, DEFAULT_SNAPS, 1, VIEWPORT)).toBe(50);
    expect(clampDrag(-50, DEFAULT_SNAPS, 1, VIEWPORT)).toBe(-50);
  });

  it('stops at the bottom of the sheet', () => {
    expect(clampDrag(5000, DEFAULT_SNAPS, 1, VIEWPORT)).toBe(0.7 * VIEWPORT);
  });

  it('resists (rubber band) beyond the top stop', () => {
    const maxUp = -(0.92 - 0.7) * VIEWPORT; // -176
    const pulled = clampDrag(-400, DEFAULT_SNAPS, 1, VIEWPORT);
    expect(pulled).toBeLessThan(maxUp);
    expect(pulled).toBeGreaterThan(-400); // moved less than the finger
    expect(clampDrag(maxUp, DEFAULT_SNAPS, 1, VIEWPORT)).toBe(maxUp);
  });
});

describe('stops', () => {
  it('shifts the sheet down by the gap between its top stop and the current one', () => {
    expect(snapShift(DEFAULT_SNAPS, 2)).toBeCloseTo(0);
    expect(snapShift(DEFAULT_SNAPS, 1)).toBeCloseTo(0.22);
    expect(snapShift(DEFAULT_SNAPS, 0)).toBeCloseTo(0.52);
  });

  it('keeps indices inside the list', () => {
    expect(clampIndex(-3, DEFAULT_SNAPS)).toBe(0);
    expect(clampIndex(9, DEFAULT_SNAPS)).toBe(2);
    expect(stepSnap(2, 1, DEFAULT_SNAPS)).toBe(2);
    expect(stepSnap(0, -1, DEFAULT_SNAPS)).toBe(0);
    expect(stepSnap(1, 1, DEFAULT_SNAPS)).toBe(2);
  });
});
