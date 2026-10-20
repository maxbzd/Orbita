/**
 * OKLCH colour maths (Björn Ottosson's OKLab) for interpolating between mood colours.
 * Pure functions; the hex strings in and out are sRGB.
 */

export interface Oklch {
  l: number;
  c: number;
  /** Degrees, 0..360. */
  h: number;
}

type Rgb = readonly [number, number, number];

const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number): number => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);

export function parseHex(hex: string): Rgb {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = [...h].map((ch) => ch + ch).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new RangeError(`Not a hex colour: ${hex}`);
  const n = (k: number): number => parseInt(h.slice(k, k + 2), 16) / 255;
  return [n(0), n(2), n(4)];
}

export function toHex([r, g, b]: Rgb): string {
  const part = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function hexToOklch(hex: string): Oklch {
  const [R, G, B] = parseHex(hex).map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(a, b);
  const h = c < 1e-6 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

export function oklchToHex({ l: L, c, h }: Oklch): string {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return toHex([fromLinear(R), fromLinear(G), fromLinear(B)]);
}

/**
 * Interpolates two colours in OKLCH along the shorter hue arc (what CSS `color-mix(in oklch)` does).
 * A colour with almost no chroma lends its hue to the other, so a grey does not swing the hue.
 */
export function mixOklch(from: string, to: string, t: number): string {
  const k = Math.min(1, Math.max(0, t));
  if (k === 0) return from.toLowerCase();
  if (k === 1) return to.toLowerCase();
  const a = hexToOklch(from);
  const b = hexToOklch(to);
  let ha = a.h;
  let hb = b.h;
  if (a.c < 0.004) ha = hb;
  else if (b.c < 0.004) hb = ha;
  let dh = hb - ha;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  return oklchToHex({
    l: a.l + (b.l - a.l) * k,
    c: a.c + (b.c - a.c) * k,
    h: (ha + dh * k + 360) % 360,
  });
}
