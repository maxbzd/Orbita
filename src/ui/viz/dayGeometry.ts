import { clamp, polar, TAU } from './polar';
import type { Point } from './polar';

/**
 * Geometry of the day figure: a 300×300 box with the
 * planet (R 48, Ø 96) in the middle, the satellite orbit at R 86 and the day ring at R 124.
 * On the ring noon is at the top and midnight at the bottom; time runs clockwise, so 06:00 is on
 * the left and 18:00 on the right.
 */

export const ORBIT_VIEW = 300;
export const ORBIT_CENTER = 150;
export const PLANET_RADIUS = 48;
export const SATELLITE_ORBIT_RADIUS = 86;
export const DAY_RING_RADIUS = 124;
export const MAX_SATELLITES = 7;
export const MINUTES_PER_DAY = 1440;

/** Angle of a minute of the day: noon is 0 (top), midnight is ±π (bottom). */
export function minutesToAngle(minutes: number): number {
  return ((clamp(minutes, 0, MINUTES_PER_DAY) - MINUTES_PER_DAY / 2) / MINUTES_PER_DAY) * TAU;
}

/** Inverse of `minutesToAngle`, for angles in [−π, π]. */
export function angleToMinutes(theta: number): number {
  return clamp((theta / TAU) * MINUTES_PER_DAY + MINUTES_PER_DAY / 2, 0, MINUTES_PER_DAY);
}

export function minutesToClock(minutes: number): string {
  const total = Math.round(clamp(minutes, 0, MINUTES_PER_DAY - 1));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export interface RingEntryInput {
  id: string;
  /** Minutes since local midnight, 0…1440. */
  minutes: number;
}

export interface RingDot<T extends RingEntryInput = RingEntryInput> extends Point {
  entry: T;
  angle: number;
  /** 0 sits on the ring; 1, −1, 2 … are neighbouring lanes where dots would collide. */
  lane: number;
  /** True when the moment has already happened (the dot is drawn at full strength). */
  past: boolean;
}

/** Lane order outwards, then inwards, so the first collision moves a dot just outside the ring. */
const LANE_SEQUENCE = [0, 1, -1, 2, -2, 3, -3] as const;

/**
 * Places the entries of a day on the ring. Records at nearly the same minute would sit on top of
 * each other, so a dot that is closer than `minGap` radians to an earlier one in its lane moves to
 * the next lane (a few px outwards or inwards). `now = null` means "no now": every dot is past.
 */
export function layoutRingDots<T extends RingEntryInput>(
  entries: readonly T[],
  now: number | null,
  { radius = DAY_RING_RADIUS, laneStep = 8, minGap = 0.09, cx = ORBIT_CENTER, cy = ORBIT_CENTER }: { radius?: number; laneStep?: number; minGap?: number; cx?: number; cy?: number } = {},
): Array<RingDot<T>> {
  const sorted = [...entries].sort((a, b) => a.minutes - b.minutes || a.id.localeCompare(b.id));
  const lastInLane = new Map<number, number>();
  return sorted.map((entry) => {
    const angle = minutesToAngle(entry.minutes);
    const lane = LANE_SEQUENCE.find((candidate) => {
      const last = lastInLane.get(candidate);
      return last === undefined || angle - last >= minGap;
    }) ?? LANE_SEQUENCE[LANE_SEQUENCE.length - 1]!;
    lastInLane.set(lane, angle);
    const point = polar(cx, cy, radius + lane * laneStep, angle);
    return { ...point, entry, angle, lane, past: now === null || entry.minutes <= now };
  });
}

export interface SatelliteInput {
  id: string;
  overdue?: boolean;
}

export interface SatelliteSlot<T extends SatelliteInput = SatelliteInput> extends Point {
  /** The commitment; absent for the "+N" bubble. */
  satellite?: T;
  /** For the "+N" bubble: how many commitments it stands for. */
  overflow?: number;
  angle: number;
}

/**
 * Spreads up to 7 satellites evenly round the orbit, starting at the top and running clockwise;
 * anything beyond 7 collapses into one extra "+N" bubble (so at most 8 slots).
 */
export function layoutSatellites<T extends SatelliteInput>(
  satellites: readonly T[],
  { max = MAX_SATELLITES, radius = SATELLITE_ORBIT_RADIUS, cx = ORBIT_CENTER, cy = ORBIT_CENTER }: { max?: number; radius?: number; cx?: number; cy?: number } = {},
): Array<SatelliteSlot<T>> {
  const shown = satellites.slice(0, max);
  const overflow = Math.max(0, satellites.length - shown.length);
  const slots = shown.length + (overflow > 0 ? 1 : 0);
  const out: Array<SatelliteSlot<T>> = [];
  for (let i = 0; i < slots; i++) {
    const angle = (i / slots) * TAU;
    const point = polar(cx, cy, radius, angle);
    const satellite = shown[i];
    out.push(satellite ? { ...point, angle, satellite } : { ...point, angle, overflow });
  }
  return out;
}
