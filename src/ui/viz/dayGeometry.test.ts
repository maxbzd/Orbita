import { describe, expect, it } from 'vitest';
import {
  MAX_SATELLITES,
  ORBIT_CENTER,
  DAY_RING_RADIUS,
  SATELLITE_ORBIT_RADIUS,
  angleToMinutes,
  layoutRingDots,
  layoutSatellites,
  minutesToAngle,
  minutesToClock,
} from './dayGeometry';
import { polar } from './polar';

describe('day ring angles', () => {
  it('puts noon on top and midnight at the bottom', () => {
    expect(minutesToAngle(720)).toBeCloseTo(0);
    expect(Math.abs(minutesToAngle(0))).toBeCloseTo(Math.PI);
    expect(Math.abs(minutesToAngle(1440))).toBeCloseTo(Math.PI);
  });

  it('runs clockwise: morning on the left, evening on the right', () => {
    const morning = polar(ORBIT_CENTER, ORBIT_CENTER, DAY_RING_RADIUS, minutesToAngle(360));
    const evening = polar(ORBIT_CENTER, ORBIT_CENTER, DAY_RING_RADIUS, minutesToAngle(1080));
    expect(morning.x).toBeCloseTo(ORBIT_CENTER - DAY_RING_RADIUS);
    expect(evening.x).toBeCloseTo(ORBIT_CENTER + DAY_RING_RADIUS);
    expect(morning.y).toBeCloseTo(ORBIT_CENTER);
    // 09:00 is between the left (06:00) and the top (12:00): up and to the left of the centre
    const nine = polar(ORBIT_CENTER, ORBIT_CENTER, DAY_RING_RADIUS, minutesToAngle(540));
    expect(nine.x).toBeLessThan(ORBIT_CENTER);
    expect(nine.y).toBeLessThan(ORBIT_CENTER);
  });

  it('inverts and clamps', () => {
    for (const m of [0, 100, 360, 720, 1000, 1440]) expect(angleToMinutes(minutesToAngle(m))).toBeCloseTo(m, 6);
    expect(minutesToAngle(-50)).toBe(minutesToAngle(0));
    expect(minutesToAngle(9999)).toBe(minutesToAngle(1440));
  });

  it('formats a clock time', () => {
    expect(minutesToClock(0)).toBe('00:00');
    expect(minutesToClock(545)).toBe('09:05');
    expect(minutesToClock(1440)).toBe('23:59');
  });
});

describe('layoutRingDots', () => {
  const entry = (id: string, minutes: number) => ({ id, minutes });

  it('keeps the past at full strength and fades the future', () => {
    const dots = layoutRingDots([entry('a', 600), entry('b', 900)], 700);
    expect(dots.find((d) => d.entry.id === 'a')!.past).toBe(true);
    expect(dots.find((d) => d.entry.id === 'b')!.past).toBe(false);
  });

  it('treats every dot as past when there is no now', () => {
    expect(layoutRingDots([entry('a', 1300)], null)[0]!.past).toBe(true);
  });

  it('puts well separated dots on the ring itself', () => {
    const dots = layoutRingDots([entry('a', 100), entry('b', 400), entry('c', 900)], null);
    for (const d of dots) {
      expect(d.lane).toBe(0);
      expect(Math.hypot(d.x - ORBIT_CENTER, d.y - ORBIT_CENTER)).toBeCloseTo(DAY_RING_RADIUS);
    }
  });

  it('moves records at the same minute to other lanes so they do not overlap', () => {
    const dots = layoutRingDots([entry('a', 600), entry('b', 600), entry('c', 601)], null);
    const lanes = new Set(dots.map((d) => d.lane));
    expect(lanes.size).toBe(3);
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        expect(Math.hypot(dots[i]!.x - dots[j]!.x, dots[i]!.y - dots[j]!.y)).toBeGreaterThan(7);
      }
    }
  });

  it('is deterministic whatever the input order', () => {
    const a = layoutRingDots([entry('b', 600), entry('a', 600)], null);
    const b = layoutRingDots([entry('a', 600), entry('b', 600)], null);
    expect(a.map((d) => [d.entry.id, d.lane])).toEqual(b.map((d) => [d.entry.id, d.lane]));
  });
});

describe('layoutSatellites', () => {
  const sats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, overdue: i === 0 }));

  it('spreads up to seven satellites evenly, the first on top', () => {
    const slots = layoutSatellites(sats(4));
    expect(slots).toHaveLength(4);
    expect(slots[0]!.x).toBeCloseTo(ORBIT_CENTER);
    expect(slots[0]!.y).toBeCloseTo(ORBIT_CENTER - SATELLITE_ORBIT_RADIUS);
    // the second is a quarter turn clockwise: on the right
    expect(slots[1]!.x).toBeCloseTo(ORBIT_CENTER + SATELLITE_ORBIT_RADIUS);
    for (const s of slots) expect(Math.hypot(s.x - ORBIT_CENTER, s.y - ORBIT_CENTER)).toBeCloseTo(SATELLITE_ORBIT_RADIUS);
  });

  it('collapses everything past seven into one "+N" bubble', () => {
    const slots = layoutSatellites(sats(10));
    expect(slots).toHaveLength(MAX_SATELLITES + 1);
    const more = slots[slots.length - 1]!;
    expect(more.satellite).toBeUndefined();
    expect(more.overflow).toBe(3);
    expect(slots.filter((s) => s.satellite)).toHaveLength(MAX_SATELLITES);
  });

  it('shows exactly seven without a bubble, and nothing for none', () => {
    expect(layoutSatellites(sats(7))).toHaveLength(7);
    expect(layoutSatellites(sats(7)).every((s) => s.satellite)).toBe(true);
    expect(layoutSatellites([])).toEqual([]);
  });
});
