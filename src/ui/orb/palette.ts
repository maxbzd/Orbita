/**
 * Orb colours. The night palette is the one from §3.4 and equals the `--orb-*` tokens (themes.css): core
 * #E8EEFF, periphery #8B6CFF, rare #5B8CFF. Canvas cannot read a gradient token, and pale dots vanish on
 * the paper of "Рассвет", so each theme has its own constants here. Deep indigo dots on paper keep the
 * same logic: the dots facing the viewer are the strongest, the limb is the faintest (alpha follows depth).
 */
export type OrbTheme = 'night' | 'dawn';

export interface OrbPalette {
  /** Dots facing the viewer. */
  core: string;
  /** Dots at the limb. */
  edge: string;
  /** About one dot in ten. */
  rare: string;
  /** Soft light behind the sphere (the --orb-glow hue: violet at night, indigo on paper). */
  glow: string;
  /** The flash of `done` (--ok). */
  ok: string;
}

export const ORB_PALETTES: Record<OrbTheme, OrbPalette> = {
  night: { core: '#E8EEFF', edge: '#8B6CFF', rare: '#5B8CFF', glow: '#8B6CFF', ok: '#6FE0B8' },
  dawn: { core: '#4030C8', edge: '#8B6CFF', rare: '#2A62D0', glow: '#5A47E8', ok: '#1F9E78' },
};

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Moves a colour towards its own luminance grey: saturation 1 = unchanged, 0 = grey. Returns "r, g, b". */
export function desaturateRgb(hex: string, saturation: number): string {
  const [r, g, b] = parseHex(hex);
  const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const k = Math.min(1, Math.max(0, saturation));
  const mix = (c: number): number => Math.round(grey + (c - grey) * k);
  return `${mix(r)}, ${mix(g)}, ${mix(b)}`;
}

/** Saturation is drawn from a few pre-rendered sprite sets: snaps to the nearest of full, paused, error. */
export const SATURATION_STEPS = [1, 0.6, 0.35] as const;

export function saturationStep(saturation: number): number {
  let best: number = SATURATION_STEPS[0];
  for (const step of SATURATION_STEPS) if (Math.abs(step - saturation) < Math.abs(best - saturation)) best = step;
  return best;
}
