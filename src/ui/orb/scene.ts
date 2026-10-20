import {
  SPARK_MAX,
  applyRotation,
  clamp01,
  depthAlpha,
  depthRadius,
  doneCurve,
  dotScale,
  easeInOut,
  fibonacciSphere,
  lerp,
  morphPositions,
  mulberry32,
  rotationYawPitch,
  shouldSpawnSpark,
  smoothstep,
  sparkAt,
  torusTargets,
  voiceDisplacement,
  backingScale,
} from './geometry';
import { PITCH_SPHERE, PITCH_TORUS, createModel, stepModel } from './model';
import type { OrbModel, OrbState } from './model';
import { saturationStep } from './palette';
import type { OrbTheme } from './palette';
import { SIZE_BUCKET_Z, SPRITE_SOFT, buildSprites } from './sprites';
import type { CanvasFactory, SpriteSet } from './sprites';

/** The slice of CanvasRenderingContext2D the scene needs; a real context satisfies it. */
export interface OrbContext {
  globalAlpha: number;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
}

/** The sphere fills this share of the canvas radius; the rest is room for the voice swell and sparks. */
export const BODY_SHARE = 0.74;

/** Static, per-point data shared by every orb with the same number of points. */
export interface OrbGeometry {
  count: number;
  sphere: Float32Array;
  torus: Float32Array;
  /** Per-dot phase of the voice ripple, coherent over the surface so it reads as a wave. */
  phase: Float32Array;
  /** Per-dot random in [0, 1): picks the colour at a given depth. */
  random: Float32Array;
  /** 1 for the ~10 % of dots drawn in the rare colour. */
  rare: Uint8Array;
  /** Azimuth around the vertical axis, for the travelling glow of the torus. */
  azimuth: Float32Array;
}

const geometryCache = new Map<number, OrbGeometry>();

export function getOrbGeometry(count: number): OrbGeometry {
  const n = Math.max(0, Math.floor(count));
  const cached = geometryCache.get(n);
  if (cached) return cached;
  const sphere = fibonacciSphere(n);
  const torus = torusTargets(sphere);
  const rand = mulberry32(0x0b1ac);
  const phase = new Float32Array(n);
  const random = new Float32Array(n);
  const rare = new Uint8Array(n);
  const azimuth = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const x = sphere[i * 3] ?? 0;
    const y = sphere[i * 3 + 1] ?? 0;
    const z = sphere[i * 3 + 2] ?? 0;
    azimuth[i] = Math.atan2(z, x);
    phase[i] = y * 5 + azimuth[i]! * 1.5 + rand() * 0.8;
    random[i] = rand();
    rare[i] = rand() < 0.1 ? 1 : 0;
  }
  const geometry: OrbGeometry = { count: n, sphere, torus, phase, random, rare, azimuth };
  if (geometryCache.size > 8) geometryCache.clear();
  geometryCache.set(n, geometry);
  return geometry;
}

interface Spark {
  index: number;
  born: number;
}

export interface OrbSceneOptions {
  /** CSS size of the (square) canvas. */
  size: number;
  points: number;
  theme: OrbTheme;
  /** Device pixel ratio; capped at 2 here as well. */
  dpr?: number;
  initialState?: OrbState;
  createCanvas?: CanvasFactory;
}

const TAU = Math.PI * 2;

/**
 * Everything the orb draws, without React: advance it with `step`, paint it with `draw`.
 * One scene holds its geometry (shared), its animation model, its sparks and its sprites.
 */
export class OrbScene {
  readonly size: number;
  readonly geometry: OrbGeometry;
  readonly model: OrbModel;
  readonly dpr: number;
  private readonly theme: OrbTheme;
  private readonly dotScale: number;
  private readonly bodyRadius: number;
  private readonly createCanvas: CanvasFactory | undefined;
  private readonly sprites = new Map<number, SpriteSet | null>();
  private readonly scratch: Float32Array;
  private readonly rotation = new Float64Array(9);
  private readonly out = new Float64Array(3);
  private readonly rand = mulberry32(0x5a4b3);
  private readonly sparks: Spark[] = [];
  private lastSpark = -Infinity;

  constructor(options: OrbSceneOptions) {
    this.size = options.size;
    this.dpr = backingScale(options.dpr ?? 1);
    this.theme = options.theme;
    this.createCanvas = options.createCanvas;
    this.geometry = getOrbGeometry(options.points);
    this.model = createModel(options.initialState ?? 'idle');
    this.dotScale = dotScale(options.size);
    this.bodyRadius = (options.size / 2) * BODY_SHARE;
    this.scratch = new Float32Array(this.geometry.sphere.length);
  }

  get sparkCount(): number {
    return this.sparks.length;
  }

  step(dtMs: number, state: OrbState, level: number): void {
    const model = stepModel(this.model, dtMs, state, level);

    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const spark = this.sparks[i]!;
      if (sparkAt(model.time - spark.born) === null) this.sparks.splice(i, 1);
    }

    if (
      state === 'listening' &&
      this.geometry.count > 0 &&
      shouldSpawnSpark(model.level, model.previousLevel, model.time - this.lastSpark)
    ) {
      this.lastSpark = model.time;
      this.spawnSparks(model.level > 0.8 ? 3 : 2);
    }
  }

  private spawnSparks(count: number): void {
    const { sphere } = this.geometry;
    rotationYawPitch(this.model.yaw, PITCH_SPHERE, this.rotation);
    let spawned = 0;
    for (let attempt = 0; attempt < 12 && spawned < count; attempt += 1) {
      const index = Math.floor(this.rand() * this.geometry.count);
      applyRotation(this.rotation, sphere[index * 3] ?? 0, sphere[index * 3 + 1] ?? 0, sphere[index * 3 + 2] ?? 0, this.out);
      if ((this.out[2] ?? 0) < 0.25) continue; // only dots that face us leave the surface
      if (this.sparks.length >= SPARK_MAX) this.sparks.shift();
      this.sparks.push({ index, born: this.model.time });
      spawned += 1;
    }
  }

  private spriteSet(saturation: number): SpriteSet | null {
    const step = saturationStep(saturation);
    if (!this.sprites.has(step)) {
      this.sprites.set(
        step,
        buildSprites(
          { theme: this.theme, saturation: step, scale: this.dotScale, dpr: this.dpr, bodyRadius: this.bodyRadius },
          this.createCanvas,
        ),
      );
    }
    return this.sprites.get(step) ?? null;
  }

  /**
   * Paints one frame into a context whose transform is already scale(dpr). `brightness` multiplies every
   * opacity (0.3 in walk mode). Returns the number of sprites drawn.
   */
  draw(ctx: OrbContext, brightness = 1): number {
    const { model, size, geometry } = this;
    ctx.clearRect(0, 0, size, size);
    const sprites = this.spriteSet(model.saturation);
    if (!sprites || geometry.count === 0) return 0;

    const bright = clamp01(brightness);
    const cx = size / 2;
    const cy = size / 2;
    const e = easeInOut(model.morph);
    const positions = e <= 0 ? geometry.sphere : morphPositions(geometry.sphere, geometry.torus, e, this.scratch);
    const pitch = lerp(PITCH_SPHERE, PITCH_TORUS, e) + 0.04 * Math.sin(model.time / 3700);
    rotationYawPitch(model.yaw, pitch, this.rotation);

    const done = Number.isFinite(model.doneAge) ? doneCurve(model.doneAge) : { scale: 1, flash: 0 };
    // Breathing: scale 1 -> 1.04 -> 1 over 4 s at rest (§2.7); the voice takes over while listening.
    const calm = model.state === 'listening' ? 0 : 1 - model.level;
    const breath = 1 + calm * 0.02 * (1 - Math.cos((model.time / 4000) * TAU)) * (model.state === 'paused' ? 0 : 1);
    const body = done.scale * breath * (1 + 0.05 * model.level);
    const radius = this.bodyRadius;

    // Light behind the body: stronger with the voice, in the flash colour when done.
    const glowAlpha = (0.55 + 0.4 * model.level + 0.2 * e) * (1 - 0.5 * e) * bright;
    const glowSize = sprites.glowSize * body * (1 + 0.15 * model.level);
    ctx.globalAlpha = clamp01(glowAlpha);
    ctx.drawImage(sprites.glow, cx - glowSize / 2, cy - glowSize / 2, glowSize, glowSize);
    if (done.flash > 0.01) {
      ctx.globalAlpha = clamp01(done.flash * 0.8 * bright);
      ctx.drawImage(sprites.flash, cx - glowSize / 2, cy - glowSize / 2, glowSize, glowSize);
    }

    const { phase, random, rare, azimuth } = geometry;
    const level = model.level;
    const swell = 1 - e; // the torus keeps still: only the sphere ripples
    const travel = (model.time / 2600) * TAU; // a slow brightness wave runs round the ring while thinking
    const out = this.out;
    let drawn = 0;

    for (let i = 0; i < geometry.count; i += 1) {
      const k = i * 3;
      const shift = level > 0 ? 1 + voiceDisplacement(level, phase[i] ?? 0, model.time) * swell : 1;
      const s = body * shift;
      applyRotation(this.rotation, (positions[k] ?? 0) * s, (positions[k + 1] ?? 0) * s, (positions[k + 2] ?? 0) * s, out);
      const z = out[2] ?? 0;

      let alpha = depthAlpha(z);
      if (e > 0) alpha *= 1 - 0.4 * e + 0.4 * e * (0.5 + 0.5 * Math.cos((azimuth[i] ?? 0) - travel));
      alpha *= bright;
      if (alpha < 0.02) continue;

      const dotRadius = depthRadius(z) * this.dotScale * (1 + 0.3 * level * (z > 0 ? z : 0));
      const colour = rare[i] ? 2 : (random[i] ?? 0) < smoothstep(0.05, 0.85, z) ? 0 : 1;
      const bucket = z < 0.25 ? 0 : z < 0.65 ? 1 : 2;
      const sprite = sprites.dots[colour * 3 + bucket];
      if (!sprite) continue;
      const side = 2 * dotRadius * SPRITE_SOFT;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite, cx + (out[0] ?? 0) * radius - side / 2, cy - (out[1] ?? 0) * radius - side / 2, side, side);
      drawn += 1;
    }

    // Sparks: single dots thrown off the surface at the peaks of the voice.
    if (this.sparks.length > 0) {
      const sparkSprite = sprites.dots[0 * 3 + 2];
      const { sphere } = geometry;
      for (const spark of this.sparks) {
        const state = sparkAt(model.time - spark.born);
        if (!state || !sparkSprite) continue;
        const r = state.radius * body;
        applyRotation(
          this.rotation,
          (sphere[spark.index * 3] ?? 0) * r,
          (sphere[spark.index * 3 + 1] ?? 0) * r,
          (sphere[spark.index * 3 + 2] ?? 0) * r,
          out,
        );
        const side = 2 * depthRadius(SIZE_BUCKET_Z[2]) * this.dotScale * SPRITE_SOFT * (0.7 + 0.5 * state.alpha);
        ctx.globalAlpha = clamp01(state.alpha * 0.95 * bright);
        ctx.drawImage(sparkSprite, cx + (out[0] ?? 0) * radius - side / 2, cy - (out[1] ?? 0) * radius - side / 2, side, side);
        drawn += 1;
      }
    }

    ctx.globalAlpha = 1;
    return drawn;
  }
}

/** True where a 2D canvas context can be created. Cheap; call it once per mount. */
export function canvas2dAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    return document.createElement('canvas').getContext('2d') != null;
  } catch {
    return false;
  }
}
