/**
 * Deterministic star fields and the grain texture. Pure functions (no DOM), so the same sky is drawn on
 * every launch and the maths can be tested. Layers: a static SVG tile for the
 * sky, a few twinkling stars on the high tier only, a 128 px noise tile for grain.
 */

/** mulberry32: a tiny seeded PRNG returning floats in [0, 1). */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Star {
  /** 0..1 across the field. */
  x: number;
  y: number;
  /** Radius in CSS px (0.5..1.6). */
  r: number;
  /** Base opacity 0.25..0.9. */
  a: number;
  /** Twinkle period in ms and phase in radians (used by the canvas layer only). */
  period: number;
  phase: number;
}

export function generateStars(count: number, seed: number): Star[] {
  const random = createRandom(seed);
  return Array.from({ length: Math.max(0, Math.floor(count)) }, () => {
    const bright = random() > 0.82; // a few brighter, larger stars among many faint ones
    return {
      x: random(),
      y: random(),
      r: bright ? 1.1 + random() * 0.5 : 0.5 + random() * 0.55,
      a: bright ? 0.65 + random() * 0.25 : 0.25 + random() * 0.4,
      period: 2600 + random() * 4200,
      phase: random() * Math.PI * 2,
    };
  });
}

/** Opacity of a star at time `t` (ms): its base opacity breathing between 55 % and 100 %. */
export function twinkleAlpha(star: Pick<Star, 'a' | 'period' | 'phase'>, t: number): number {
  const wave = 0.775 + 0.225 * Math.sin((t / star.period) * Math.PI * 2 + star.phase);
  return star.a * wave;
}

export const STAR_TILE_SIZE = 360;

/** SVG source of the static star tile (36 points). Stars sit away from the edge so the tile repeats cleanly. */
export function starTileSvg(size = STAR_TILE_SIZE, count = 36, seed = 20250611): string {
  const dots = generateStars(count, seed)
    .map((s) => {
      const x = (6 + s.x * (size - 12)).toFixed(1);
      const y = (6 + s.y * (size - 12)).toFixed(1);
      return `<circle cx="${x}" cy="${y}" r="${s.r.toFixed(2)}" fill="#fff" fill-opacity="${s.a.toFixed(2)}"/>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${dots}</svg>`;
}

let tileUrl: string | undefined;

/** `url("data:image/svg+xml,...")` for CSS; computed once. */
export function starTileUrl(): string {
  tileUrl ??= `url("data:image/svg+xml,${encodeURIComponent(starTileSvg())}")`;
  return tileUrl;
}

export const GRAIN_SIZE = 128;

/**
 * RGBA noise for the grain tile: half the pixels white, half black, each with a random alpha. On a dark
 * sky only the white specks show, on paper only the black ones; the average brightness does not shift.
 */
export function grainPixels(size = GRAIN_SIZE, seed = 1337): Uint8ClampedArray<ArrayBuffer> {
  const random = createRandom(seed);
  const data = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  for (let i = 0; i < size * size; i++) {
    const v = random() > 0.5 ? 255 : 0;
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = Math.floor(random() * 200);
  }
  return data;
}

let grainUrl: string | undefined;

/**
 * `url("data:image/png;base64,...")` of the noise tile, drawn once with a canvas. Returns '' where
 * canvas is unavailable (the grain is a nicety, never required).
 */
export function grainTileUrl(): string {
  if (grainUrl !== undefined) return grainUrl;
  grainUrl = '';
  try {
    const canvas = document.createElement('canvas');
    canvas.width = GRAIN_SIZE;
    canvas.height = GRAIN_SIZE;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(new ImageData(grainPixels(GRAIN_SIZE), GRAIN_SIZE, GRAIN_SIZE), 0, 0);
      const data = canvas.toDataURL('image/png');
      if (data.startsWith('data:image/png')) grainUrl = `url("${data}")`;
    }
  } catch {
    grainUrl = '';
  }
  return grainUrl;
}

/** Test hook: forget the cached tiles. */
export function resetTileCache(): void {
  tileUrl = undefined;
  grainUrl = undefined;
}
