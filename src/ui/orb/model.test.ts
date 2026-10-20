import { describe, expect, it } from 'vitest';
import { DONE_MS } from './geometry';
import { MORPH_TO_SPHERE_MS, MORPH_TO_TORUS_MS, SATURATION, SPIN_PERIOD_MS, createModel, stepModel } from './model';
import type { OrbState } from './model';

const run = (model: ReturnType<typeof createModel>, ms: number, state: OrbState, level = 0, step = 16): void => {
  for (let t = 0; t < ms; t += step) stepModel(model, Math.min(step, ms - t), state, level);
};

describe('orb model', () => {
  it('turns once in 90 s at rest', () => {
    const m = createModel();
    run(m, SPIN_PERIOD_MS / 4, 'idle', 0, 250);
    expect(m.yaw).toBeCloseTo(Math.PI / 2, 2);
  });

  it('slows the rotation while listening so the shimmer is readable', () => {
    const idle = createModel('idle');
    const listening = createModel('listening');
    run(idle, 10_000, 'idle');
    run(listening, 10_000, 'listening');
    expect(listening.yaw).toBeLessThan(idle.yaw * 0.6);
  });

  it('freezes when paused and loses 40 % of the saturation', () => {
    const m = createModel('listening');
    run(m, 3000, 'paused');
    const yaw = m.yaw;
    run(m, 2000, 'paused');
    expect(m.spin).toBe(0);
    expect(m.yaw).toBe(yaw);
    expect(m.saturation).toBeCloseTo(0.6, 2);
    expect(SATURATION.paused).toBe(0.6);
  });

  it('follows the level only while listening, with attack faster than release', () => {
    const m = createModel('listening');
    run(m, 120, 'listening', 1, 8);
    const risen = m.level;
    expect(risen).toBeGreaterThan(0.9);
    run(m, 120, 'listening', 0, 8);
    expect(m.level).toBeGreaterThan(0.3); // 220 ms release: still audible after 120 ms
    expect(m.level).toBeLessThan(risen);

    const quiet = createModel('idle');
    run(quiet, 500, 'idle', 1);
    expect(quiet.level).toBe(0);
  });

  it('lets the level die away after listening ends', () => {
    const m = createModel('listening');
    run(m, 200, 'listening', 1);
    run(m, 3000, 'thinking', 1);
    expect(m.level).toBe(0);
  });

  it('folds into the torus in 800 ms and back in 600 ms', () => {
    const m = createModel('idle');
    run(m, MORPH_TO_TORUS_MS / 2, 'thinking');
    expect(m.morph).toBeCloseTo(0.5, 1);
    run(m, MORPH_TO_TORUS_MS / 2 + 50, 'thinking');
    expect(m.morph).toBe(1);
    run(m, MORPH_TO_SPHERE_MS / 2, 'done');
    expect(m.morph).toBeCloseTo(0.5, 1);
    run(m, MORPH_TO_SPHERE_MS, 'done');
    expect(m.morph).toBe(0);
  });

  it('keeps turning slowly in the torus, so a long wait does not look frozen', () => {
    const m = createModel('thinking');
    const before = m.yaw;
    run(m, 5000, 'thinking');
    expect(m.yaw).toBeGreaterThan(before);
  });

  it('starts the done gesture on entering done and ends it for good', () => {
    const m = createModel('thinking');
    run(m, 100, 'thinking');
    expect(m.doneAge).toBe(Number.POSITIVE_INFINITY);
    run(m, 16, 'done');
    expect(m.doneAge).toBeLessThan(40);
    run(m, DONE_MS * 2 + 100, 'done');
    expect(m.doneAge).toBe(Number.POSITIVE_INFINITY);
    run(m, 100, 'idle');
    expect(m.doneAge).toBe(Number.POSITIVE_INFINITY);
  });

  it('ignores negative time steps', () => {
    const m = createModel();
    stepModel(m, -50, 'idle', 0);
    expect(m.time).toBe(0);
    expect(m.yaw).toBe(0);
  });

  it('an error drains the colour without shaking', () => {
    const m = createModel('idle');
    run(m, 3000, 'error', 1);
    expect(m.saturation).toBeCloseTo(0.35, 1);
    expect(m.level).toBe(0);
  });
});
