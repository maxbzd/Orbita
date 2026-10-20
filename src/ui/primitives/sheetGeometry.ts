/**
 * Pure geometry of the bottom sheet: three stops at 40 / 70 / 92 %
 * of the viewport height. Kept free of React and the DOM so it can be tested exhaustively.
 */

export const DEFAULT_SNAPS: readonly number[] = [0.4, 0.7, 0.92];

/** How far ahead (ms) a flick is projected when choosing the stop it ends on. */
const PROJECTION_MS = 180;
/** A downward flick faster than this (px/ms) from the lowest stop dismisses the sheet. */
const DISMISS_VELOCITY = 0.8;
/** Dragged below this share of the lowest stop (after projection) dismisses the sheet. */
const DISMISS_RATIO = 0.55;

export type ReleaseResult = { kind: 'snap'; index: number } | { kind: 'close' };

export interface ReleaseInput {
  snaps: readonly number[];
  /** Index of the stop the drag started from. */
  index: number;
  /** Finger travel in px; positive = downward. */
  offset: number;
  /** px/ms; positive = downward. */
  velocity: number;
  /** Viewport height in px. */
  viewport: number;
  /** When false the sheet never closes by dragging: it settles on the lowest stop. */
  dismissible: boolean;
}

export function clampIndex(index: number, snaps: readonly number[]): number {
  return Math.min(snaps.length - 1, Math.max(0, Math.round(index)));
}

/** Decides where the sheet goes when the finger lifts. */
export function resolveRelease({ snaps, index, offset, velocity, viewport, dismissible }: ReleaseInput): ReleaseResult {
  if (snaps.length === 0 || viewport <= 0) return { kind: 'snap', index: 0 };
  const start = clampIndex(index, snaps);
  const lowest = snaps[0]!;
  // Height the sheet would reach if the gesture carried on for a moment.
  const projected = (snaps[start]! * viewport - offset - velocity * PROJECTION_MS) / viewport;

  if (dismissible && (projected < lowest * DISMISS_RATIO || (start === 0 && velocity > DISMISS_VELOCITY))) {
    return { kind: 'close' };
  }
  let best = 0;
  let bestDistance = Infinity;
  snaps.forEach((snap, i) => {
    const distance = Math.abs(snap - projected);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  });
  return { kind: 'snap', index: best };
}

/** Limits a drag: up to the top stop, down to the bottom of the sheet (with a little rubber band above). */
export function clampDrag(offset: number, snaps: readonly number[], index: number, viewport: number): number {
  const top = snaps[snaps.length - 1] ?? 1;
  const current = snaps[clampIndex(index, snaps)] ?? top;
  const maxUp = -(top - current) * viewport; // negative
  if (offset < maxUp) return maxUp + (offset - maxUp) * 0.15;
  return Math.min(offset, current * viewport);
}

/** Keyboard step on the grabber: ArrowUp -> next taller stop, ArrowDown -> shorter; null = close request. */
export function stepSnap(index: number, direction: 1 | -1, snaps: readonly number[]): number {
  return clampIndex(index + direction, snaps);
}

/** CSS length of the vertical shift for a stop: the sheet is as tall as its top stop. */
export function snapShift(snaps: readonly number[], index: number): number {
  const top = snaps[snaps.length - 1] ?? 1;
  const current = snaps[clampIndex(index, snaps)] ?? top;
  return top - current;
}
