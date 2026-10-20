import type { TypeKind } from '../primitives/kinds';

/** What the extraction pass found, anchored to a second of the recording. */
export interface AudioMarker {
  id: string;
  /** Seconds from the start of the recording. */
  time: number;
  kind: TypeKind;
  /** The short wording shown in the expanded pill ("Запустить интенсив в ноябре"). */
  label: string;
}

export interface PlacedMarker {
  marker: AudioMarker;
  /** Position along the recording, 0..1. */
  fraction: number;
  /** 0 = the upper lane, 1 = the lower one. */
  lane: 0 | 1;
}

/** Closest two dots may sit in one lane, px. A dot is 10 px; the rest is breathing room. */
export const MIN_MARKER_GAP = 24;

/**
 * Puts markers on two lanes so neighbours do not hide each other: time order, the upper lane first, the
 * lower one when the upper is taken within `minGap` px. When both are taken the roomier one wins (a rare
 * overlap is better than dropping a marker). `width` is the lane width in px.
 */
export function placeMarkers(
  markers: readonly AudioMarker[],
  durationSec: number,
  width: number,
  minGap: number = MIN_MARKER_GAP,
): PlacedMarker[] {
  const duration = durationSec > 0 && Number.isFinite(durationSec) ? durationSec : 0;
  const sorted = [...markers].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const last: [number, number] = [-Infinity, -Infinity];
  return sorted.map((marker) => {
    const fraction = duration > 0 ? Math.min(1, Math.max(0, marker.time / duration)) : 0;
    const x = fraction * width;
    const gap0 = x - last[0];
    const gap1 = x - last[1];
    const lane: 0 | 1 = gap0 >= minGap ? 0 : gap1 >= minGap ? 1 : gap0 >= gap1 ? 0 : 1;
    last[lane] = x;
    return { marker, fraction, lane };
  });
}

/** How long a marker stays "current" after the playhead passes it, seconds. */
export const ACTIVE_WINDOW_SECONDS = 4;

/** The marker the playhead has just passed (within `windowSec`), or null. */
export function activeMarkerAt(
  markers: readonly AudioMarker[],
  timeSec: number,
  windowSec: number = ACTIVE_WINDOW_SECONDS,
): AudioMarker | null {
  let found: AudioMarker | null = null;
  for (const marker of markers) {
    if (marker.time <= timeSec && timeSec - marker.time <= windowSec && (!found || marker.time >= found.time)) found = marker;
  }
  return found;
}

/**
 * The expanded pill grows to the right of its dot, except near the right edge where it grows to the left,
 * so the dot always stays under its time and the pill stays inside the lane.
 */
export function pillSide(fraction: number): 'start' | 'end' {
  return fraction > 0.6 ? 'end' : 'start';
}
