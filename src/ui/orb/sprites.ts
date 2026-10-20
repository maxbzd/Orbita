import { depthRadius } from './geometry';
import { ORB_PALETTES, desaturateRgb } from './palette';
import type { OrbTheme } from './palette';

/**
 * Pre-rendered dot sprites (§3.4): 3 sizes x 3 colours drawn with `drawImage`, never `arc()`.
 * Colour index: 0 core, 1 edge, 2 rare. Size index: 0 small, 1 medium, 2 large (by depth).
 */

export const DOT_COLORS = 3;
export const DOT_SIZES = 3;
/** The depth each size bucket is rendered for; the dot is then scaled to its real radius when drawn. */
export const SIZE_BUCKET_Z = [0.17, 0.5, 0.83] as const;
/** Half-size of a sprite in dot radii: the soft edge reaches this far. */
export const SPRITE_SOFT = 1.7;

export interface SpriteSet {
  /** Index = colour * 3 + size. */
  dots: CanvasImageSource[];
  /** Radius (CSS px, before scaling) each size bucket was rendered for. */
  bucketRadius: number[];
  /** Soft light behind the sphere. */
  glow: CanvasImageSource;
  /** The same light in the flash colour. */
  flash: CanvasImageSource;
  /** Side of the glow sprites, CSS px. */
  glowSize: number;
}

export type CanvasFactory = (width: number, height: number) => HTMLCanvasElement | null;

export const defaultCanvasFactory: CanvasFactory = (width, height) => {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
};

export interface SpriteOptions {
  theme: OrbTheme;
  /** One of SATURATION_STEPS. */
  saturation: number;
  /** Dot scale for the orb size (dotScale()). */
  scale: number;
  /** Device pixel ratio, already capped at 2. */
  dpr: number;
  /** Orb body radius in CSS px: the glow is sized from it. */
  bodyRadius: number;
}

const cache = new Map<string, SpriteSet | null>();

export function resetSpriteCache(): void {
  cache.clear();
}

function radial(
  ctx: CanvasRenderingContext2D,
  size: number,
  rgb: string,
  stops: ReadonlyArray<readonly [number, number]>,
): void {
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  for (const [at, alpha] of stops) gradient.addColorStop(at, `rgba(${rgb}, ${alpha})`);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
}

/** Renders the sprites, or returns null where there is no 2D canvas (jsdom, very old browsers). */
export function buildSprites(options: SpriteOptions, create: CanvasFactory = defaultCanvasFactory): SpriteSet | null {
  const { theme, saturation, scale, dpr, bodyRadius } = options;
  const key = `${theme}|${saturation}|${scale.toFixed(3)}|${dpr}|${Math.round(bodyRadius)}`;
  if (create === defaultCanvasFactory && cache.has(key)) return cache.get(key) ?? null;

  const palette = ORB_PALETTES[theme];
  const colors = [palette.core, palette.edge, palette.rare].map((hex) => desaturateRgb(hex, saturation));
  const dots: CanvasImageSource[] = [];
  const bucketRadius: number[] = [];

  let ok = true;
  for (const rgb of colors) {
    for (const z of SIZE_BUCKET_Z) {
      const radius = depthRadius(z) * scale;
      const side = Math.max(4, Math.ceil(2 * radius * SPRITE_SOFT * dpr) + 2);
      const canvas = create(side, side);
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) {
        ok = false;
        break;
      }
      // Bright centre, a soft shoulder, then nothing: reads as a lit point, not a flat disc.
      radial(ctx, side, rgb, [[0, 1], [0.38, 0.92], [0.62, 0.38], [1, 0]]);
      dots.push(canvas);
      if (dots.length <= DOT_SIZES) bucketRadius.push(radius);
    }
    if (!ok) break;
  }

  let result: SpriteSet | null = null;
  if (ok) {
    const glowSize = Math.max(8, bodyRadius * 2 * 1.4);
    const glowSide = Math.ceil(glowSize * dpr);
    const glowCanvas = create(glowSide, glowSide);
    const flashCanvas = create(glowSide, glowSide);
    const glowCtx = glowCanvas?.getContext('2d');
    const flashCtx = flashCanvas?.getContext('2d');
    if (glowCanvas && flashCanvas && glowCtx && flashCtx) {
      radial(glowCtx, glowSide, desaturateRgb(palette.glow, saturation), [[0, 0.5], [0.3, 0.26], [0.65, 0.08], [1, 0]]);
      radial(flashCtx, glowSide, desaturateRgb(palette.ok, saturation), [[0, 0.85], [0.35, 0.4], [0.7, 0.1], [1, 0]]);
      result = { dots, bucketRadius, glow: glowCanvas, flash: flashCanvas, glowSize };
    }
  }

  if (create === defaultCanvasFactory) cache.set(key, result);
  return result;
}
