import { describe, expect, it } from 'vitest';
import { EDGE_GUARD_PX, SWIPE_DISTANCE_PX, SWIPE_VELOCITY_PX_PER_MS, resolveSwipe, startsInsideGuard, swipeProgress, velocityOf } from './swipe';

const release = (dx: number, dy = 0, vx = 0, vy = 0) => resolveSwipe({ dx, dy, vx, vy });

describe('swipe thresholds', () => {
  it('right accepts, left dismisses, once 96 px are covered', () => {
    expect(release(SWIPE_DISTANCE_PX)).toBe('accept');
    expect(release(-SWIPE_DISTANCE_PX)).toBe('dismiss');
    expect(release(SWIPE_DISTANCE_PX - 1)).toBeNull();
    expect(release(-(SWIPE_DISTANCE_PX - 1))).toBeNull();
  });

  it('a quick flick decides before 96 px', () => {
    expect(release(40, 0, SWIPE_VELOCITY_PX_PER_MS)).toBe('accept');
    expect(release(-40, 0, -0.8)).toBe('dismiss');
    expect(release(40, 0, SWIPE_VELOCITY_PX_PER_MS - 0.01)).toBeNull();
  });

  it('a twitch is not a flick: the finger must have travelled at least 24 px', () => {
    expect(release(10, 0, 2)).toBeNull();
  });

  it('a flick against the direction of travel does not decide', () => {
    // The finger went right but is flying left at release (it turned back): no accept.
    expect(release(40, 0, -0.9)).toBeNull();
  });

  it('up edits, by distance or by speed; down never does', () => {
    expect(release(0, -SWIPE_DISTANCE_PX)).toBe('edit');
    expect(release(0, -(SWIPE_DISTANCE_PX - 1))).toBeNull();
    expect(release(0, -40, 0, -SWIPE_VELOCITY_PX_PER_MS)).toBe('edit');
    expect(release(0, SWIPE_DISTANCE_PX * 2)).toBeNull();
    expect(release(0, 60, 0, 2)).toBeNull();
  });

  it('the stronger axis wins on a diagonal', () => {
    expect(release(100, -60)).toBe('accept');
    expect(release(30, -110)).toBe('edit');
    expect(release(-100, -60)).toBe('dismiss');
  });
});

describe('edge guard', () => {
  it('ignores a touch within 24 px of either edge so the system back gesture works', () => {
    expect(startsInsideGuard(EDGE_GUARD_PX - 1, 390)).toBe(false);
    expect(startsInsideGuard(EDGE_GUARD_PX, 390)).toBe(true);
    expect(startsInsideGuard(390 - EDGE_GUARD_PX, 390)).toBe(true);
    expect(startsInsideGuard(390 - EDGE_GUARD_PX + 1, 390)).toBe(false);
  });
});

describe('progress while dragging', () => {
  it('lights the edge in proportion to the travel, only one at a time', () => {
    expect(swipeProgress(48, 0)).toEqual({ accept: 0.5, dismiss: 0, edit: 0 });
    expect(swipeProgress(-96, 10)).toEqual({ accept: 0, dismiss: 1, edit: 0 });
    expect(swipeProgress(500, 0).accept).toBe(1);
    expect(swipeProgress(5, -80)).toEqual({ accept: 0, dismiss: 0, edit: 80 / 96 });
    expect(swipeProgress(0, 50)).toEqual({ accept: 0, dismiss: 0, edit: 0 });
  });
});

describe('velocity', () => {
  it('is distance over time across the last 100 ms', () => {
    expect(velocityOf([[0, 0], [50, 10], [100, 60], [150, 110]])).toBeCloseTo(1, 5);
  });

  it('is zero without movement or samples', () => {
    expect(velocityOf([])).toBe(0);
    expect(velocityOf([[10, 5]])).toBe(0);
    expect(velocityOf([[0, 5], [200, 5]])).toBe(0);
  });
});
