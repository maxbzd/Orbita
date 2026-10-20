/**
 * The swipe of the card stack: right accepts, left dismisses, up edits.
 * A decision needs 96 px of travel or a speed of 0.5 px/ms; a gesture that starts in the 24 px at the screen edge
 * belongs to the system "back" gesture and is ignored.
 */

export const SWIPE_DISTANCE_PX = 96;
export const SWIPE_VELOCITY_PX_PER_MS = 0.5;
export const EDGE_GUARD_PX = 24;
/** The card leaves the screen in this long once a decision is made. */
export const FLY_OUT_MS = 220;
/** A flick must also have moved this far, or a twitch of the finger would decide. */
export const MIN_FLICK_TRAVEL_PX = 24;

export type SwipeDecision = 'accept' | 'dismiss' | 'edit';

export interface SwipeRelease {
  /** Travel since the finger went down, px. Right and down are positive. */
  dx: number;
  dy: number;
  /** Speed at release, px/ms, same signs. */
  vx: number;
  vy: number;
}

/** What a released gesture means, or null when the card springs back. */
export function resolveSwipe({ dx, dy, vx, vy }: SwipeRelease): SwipeDecision | null {
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if (horizontal) {
    const far = Math.abs(dx) >= SWIPE_DISTANCE_PX;
    const fast = Math.abs(vx) >= SWIPE_VELOCITY_PX_PER_MS && Math.abs(dx) >= MIN_FLICK_TRAVEL_PX && Math.sign(vx) === Math.sign(dx);
    if (!far && !fast) return null;
    return dx > 0 ? 'accept' : 'dismiss';
  }
  // Only upwards means something; pulling down just springs back.
  if (dy >= 0) return null;
  const far = -dy >= SWIPE_DISTANCE_PX;
  const fast = -vy >= SWIPE_VELOCITY_PX_PER_MS && -dy >= MIN_FLICK_TRAVEL_PX;
  return far || fast ? 'edit' : null;
}

/** A gesture may start only away from the screen edges, so the system back swipe still works. */
export function startsInsideGuard(clientX: number, viewportWidth: number): boolean {
  return clientX >= EDGE_GUARD_PX && clientX <= viewportWidth - EDGE_GUARD_PX;
}

/** Progress 0..1 toward a decision while dragging: drives the glow of the card edge. */
export function swipeProgress(dx: number, dy: number): { accept: number; dismiss: number; edit: number } {
  const clamp = (value: number): number => Math.min(1, Math.max(0, value / SWIPE_DISTANCE_PX));
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  return {
    accept: horizontal ? clamp(dx) : 0,
    dismiss: horizontal ? clamp(-dx) : 0,
    edit: horizontal ? 0 : clamp(-dy),
  };
}

/** Speed over the last samples of a drag, px/ms; samples are `[timeMs, value]`. */
export function velocityOf(samples: ReadonlyArray<readonly [number, number]>, windowMs = 100): number {
  const last = samples[samples.length - 1];
  if (!last) return 0;
  const recent = samples.filter(([time]) => last[0] - time <= windowMs);
  const first = recent[0];
  if (!first || first === last || last[0] === first[0]) return 0;
  return (last[1] - first[1]) / (last[0] - first[0]);
}
