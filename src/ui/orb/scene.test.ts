import { describe, expect, it } from 'vitest';
import { SPARK_LIFE_MS } from './geometry';
import { OrbScene, BODY_SHARE, getOrbGeometry } from './scene';
import type { OrbContext, OrbSceneOptions } from './scene';
import type { OrbState } from './model';
import { buildSprites, resetSpriteCache } from './sprites';

interface Call {
  image: unknown;
  x: number;
  y: number;
  w: number;
  h: number;
  alpha: number;
}

/** A context that records every drawImage. */
class RecordingContext implements OrbContext {
  globalAlpha = 1;
  calls: Call[] = [];
  clears = 0;
  clearRect(): void {
    this.clears += 1;
    this.calls = [];
  }
  drawImage(image: CanvasImageSource, x: number, y: number, w: number, h: number): void {
    this.calls.push({ image, x, y, w, h, alpha: this.globalAlpha });
  }
}

/** A canvas that is only good for being a distinct sprite. */
const fakeCanvas = (): HTMLCanvasElement =>
  ({
    getContext: () => ({
      clearRect: () => undefined,
      fillRect: () => undefined,
      fillStyle: '',
      createRadialGradient: () => ({ addColorStop: () => undefined }),
    }),
  }) as unknown as HTMLCanvasElement;

const SIZE = 220;
const opts = (over: Partial<OrbSceneOptions> = {}): OrbSceneOptions => ({
  size: SIZE,
  points: 400,
  theme: 'night',
  dpr: 2,
  createCanvas: fakeCanvas,
  ...over,
});

const run = (scene: OrbScene, ms: number, state: OrbState, level = 0, step = 16): void => {
  for (let t = 0; t < ms; t += step) scene.step(Math.min(step, ms - t), state, level);
};

/** Distance of each drawn dot centre from the middle of the canvas, in body radii. */
const radii = (calls: Call[]): number[] => {
  const R = (SIZE / 2) * BODY_SHARE;
  return calls.map((c) => Math.hypot(c.x + c.w / 2 - SIZE / 2, c.y + c.h / 2 - SIZE / 2) / R);
};

describe('OrbScene', () => {
  it('draws the glow first, then the dots of the facing side and a dim far side', () => {
    const scene = new OrbScene(opts());
    const ctx = new RecordingContext();
    const drawn = scene.draw(ctx);
    expect(ctx.clears).toBe(1);
    expect(drawn).toBeGreaterThan(400 * 0.55);
    expect(drawn).toBeLessThanOrEqual(400);
    expect(ctx.calls).toHaveLength(drawn + 1); // + the glow
    expect(ctx.calls[0]?.w).toBeGreaterThan(SIZE * 0.5); // the glow sprite is the big one
    expect(ctx.globalAlpha).toBe(1); // left clean for the next user of the context
  });

  it('keeps the sphere inside its canvas, with room to swell', () => {
    const scene = new OrbScene(opts());
    const ctx = new RecordingContext();
    scene.draw(ctx);
    const dots = ctx.calls.slice(1);
    expect(Math.max(...radii(dots))).toBeLessThanOrEqual(1.06);
    expect(Math.max(...radii(dots))).toBeGreaterThan(0.95);
    for (const c of dots) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(SIZE);
    }
  });

  it('uses only nine dot sprites plus the two lights (3 sizes x 3 colours)', () => {
    const scene = new OrbScene(opts({ points: 1200 }));
    const ctx = new RecordingContext();
    scene.draw(ctx);
    expect(new Set(ctx.calls.map((c) => c.image)).size).toBeLessThanOrEqual(9 + 1);
  });

  it('grows with the voice: dots swell and sparks leave the surface at a peak', () => {
    const quiet = new OrbScene(opts());
    const loud = new OrbScene(opts());
    const a = new RecordingContext();
    const b = new RecordingContext();
    run(quiet, 600, 'listening', 0);
    run(loud, 400, 'listening', 0);
    run(loud, 200, 'listening', 1, 8);
    quiet.draw(a);
    loud.draw(b);
    expect(Math.max(...radii(b.calls.slice(1)))).toBeGreaterThan(Math.max(...radii(a.calls.slice(1))) + 0.04);
    expect(loud.sparkCount).toBeGreaterThan(0);
    expect(quiet.sparkCount).toBe(0);
  });

  it('throws no sparks while paused, and old sparks expire', () => {
    const scene = new OrbScene(opts());
    run(scene, 300, 'listening', 0);
    run(scene, 100, 'listening', 1, 8);
    expect(scene.sparkCount).toBeGreaterThan(0);
    run(scene, SPARK_LIFE_MS + 50, 'paused', 1);
    expect(scene.sparkCount).toBe(0);
  });

  it('folds into a torus: the outline is narrower than the sphere and the dots are not all on the rim', () => {
    const sphere = new OrbScene(opts({ points: 800 }));
    const torus = new OrbScene(opts({ points: 800 }));
    run(torus, 1000, 'thinking');
    expect(torus.model.morph).toBe(1);
    const a = new RecordingContext();
    const b = new RecordingContext();
    sphere.draw(a);
    torus.draw(b);
    const rs = radii(a.calls.slice(1));
    const rt = radii(b.calls.slice(1));
    expect(Math.max(...rt)).toBeLessThan(Math.max(...rs) - 0.04);
    const rimShare = (r: number[]): number => r.filter((v) => v > 0.8).length / r.length;
    expect(rimShare(rt)).toBeLessThan(rimShare(rs));
  });

  it('flashes with the ok light when done, and only then', () => {
    const scene = new OrbScene(opts());
    const ctx = new RecordingContext();
    scene.draw(ctx);
    const rest = ctx.calls.filter((c) => c.w > SIZE * 0.5).length;
    expect(rest).toBe(1);

    run(scene, 300, 'done');
    scene.draw(ctx);
    expect(ctx.calls.filter((c) => c.w > SIZE * 0.5).length).toBe(2);

    run(scene, 1500, 'done');
    scene.draw(ctx);
    expect(ctx.calls.filter((c) => c.w > SIZE * 0.5).length).toBe(1);
  });

  it('dims every opacity in walk mode (30 % brightness)', () => {
    const scene = new OrbScene(opts());
    const ctx = new RecordingContext();
    scene.draw(ctx, 0.3);
    expect(Math.max(...ctx.calls.map((c) => c.alpha))).toBeLessThanOrEqual(0.3 + 1e-9);
  });

  it('switches to the desaturated sprites when paused', () => {
    const scene = new OrbScene(opts());
    const ctx = new RecordingContext();
    scene.draw(ctx);
    const before = new Set(ctx.calls.map((c) => c.image));
    run(scene, 3000, 'paused');
    scene.draw(ctx);
    const after = new Set(ctx.calls.map((c) => c.image));
    for (const image of after) expect(before.has(image)).toBe(false);
  });

  it('is deterministic', () => {
    const a = new OrbScene(opts());
    const b = new OrbScene(opts());
    const ca = new RecordingContext();
    const cb = new RecordingContext();
    run(a, 700, 'listening', 0.6);
    run(b, 700, 'listening', 0.6);
    a.draw(ca);
    b.draw(cb);
    expect(ca.calls.map((c) => [c.x, c.y, c.w, c.alpha])).toEqual(cb.calls.map((c) => [c.x, c.y, c.w, c.alpha]));
  });

  it('draws nothing where no sprite can be rendered, and does not throw', () => {
    const scene = new OrbScene(opts({ createCanvas: () => null }));
    const ctx = new RecordingContext();
    expect(scene.draw(ctx)).toBe(0);
    expect(ctx.calls).toHaveLength(0);
  });

  it('caps the backing scale at 2 and shrinks dots for small orbs', () => {
    expect(new OrbScene(opts({ dpr: 3 })).dpr).toBe(2);
    const small = new OrbScene(opts({ size: 68, points: 200 }));
    const big = new OrbScene(opts({ size: 220, points: 200 }));
    const a = new RecordingContext();
    const b = new RecordingContext();
    small.draw(a);
    big.draw(b);
    expect(Math.max(...a.calls.slice(1).map((c) => c.w))).toBeLessThan(Math.max(...b.calls.slice(1).map((c) => c.w)));
  });

  it('has no points to draw for an empty orb', () => {
    const scene = new OrbScene(opts({ points: 0 }));
    expect(scene.draw(new RecordingContext())).toBe(0);
  });
});

describe('getOrbGeometry', () => {
  it('is shared between orbs with the same point count and has ~10 % rare dots', () => {
    expect(getOrbGeometry(300)).toBe(getOrbGeometry(300));
    const g = getOrbGeometry(1200);
    const rare = g.rare.reduce((sum, v) => sum + v, 0);
    expect(rare / 1200).toBeGreaterThan(0.07);
    expect(rare / 1200).toBeLessThan(0.13);
    expect(g.phase).toHaveLength(1200);
  });
});

describe('buildSprites', () => {
  it('renders 3 x 3 dot sprites, two lights, and caches the default factory result', () => {
    resetSpriteCache();
    const set = buildSprites(
      { theme: 'night', saturation: 1, scale: 1, dpr: 2, bodyRadius: 80 },
      fakeCanvas,
    );
    expect(set?.dots).toHaveLength(9);
    expect(set?.bucketRadius).toHaveLength(3);
    expect(set?.bucketRadius[0]).toBeLessThan(set?.bucketRadius[2] ?? 0);
    expect(set?.glowSize).toBeCloseTo(80 * 2 * 1.4, 6);
  });

  it('returns null when the context is missing', () => {
    expect(
      buildSprites({ theme: 'dawn', saturation: 1, scale: 1, dpr: 1, bodyRadius: 30 }, () => ({ getContext: () => null }) as unknown as HTMLCanvasElement),
    ).toBeNull();
  });
});
