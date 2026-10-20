/**
 * Test helper: reads the design tokens straight from the stylesheets and does the colour maths
 * (WCAG 2.x contrast), so the contrast checks run on the real CSS and not on a copy of it.
 * Only a small, strict subset of CSS is understood: rules, @media/@supports nesting, custom
 * properties, hex / rgb() / color-mix(in srgb) / var() values. It is not a general CSS parser.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CssRule {
  /** The enclosing at-rule condition (e.g. `(prefers-color-scheme: light)`), or null at top level. */
  media: string | null;
  /** Individual selectors of the rule's selector list, whitespace-normalised. */
  selectors: string[];
  decls: Map<string, string>;
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function readStyle(name: string): string {
  // Not `new URL(name, import.meta.url)`: Vite rewrites that pattern as an asset reference.
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), name), 'utf8');
}

/** Splits at top-level occurrences of `sep` (outside parentheses). */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

export function parseCss(source: string, media: string | null = null): CssRule[] {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: CssRule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open === -1) break;
    const prelude = norm(text.slice(i, open));
    let depth = 1;
    let j = open + 1;
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}') depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    i = j;
    if (prelude.startsWith('@media') || prelude.startsWith('@supports')) {
      rules.push(...parseCss(body, norm(prelude.replace(/^@(media|supports)\s*/, ''))));
    } else if (prelude.startsWith('@')) {
      continue; // @keyframes, @font-face: no tokens inside
    } else {
      const decls = new Map<string, string>();
      for (const part of splitTop(body, ';')) {
        const colon = part.indexOf(':');
        if (colon === -1) continue;
        const name = part.slice(0, colon).trim();
        if (name.startsWith('--')) decls.set(name, norm(part.slice(colon + 1)));
      }
      rules.push({ media, selectors: prelude.split(',').map(norm), decls });
    }
  }
  return rules;
}

/** All custom-property declarations from the given selectors (in file order, later wins). */
export function collect(rules: CssRule[], selectors: string[], media: string | null = null): Map<string, string> {
  const out = new Map<string, string>();
  for (const rule of rules) {
    if (rule.media !== media) continue;
    if (!rule.selectors.some((s) => selectors.includes(s))) continue;
    for (const [k, v] of rule.decls) out.set(k, v);
  }
  return out;
}

// ───────── colour maths ─────────

export type Rgba = readonly [number, number, number, number]; // r,g,b 0-255; a 0-1

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function parseHex(hex: string): Rgba {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  const n = (k: number): number => parseInt(h.slice(k, k + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

function parseChannel(token: string, scale: number): number {
  return token.endsWith('%') ? (parseFloat(token) / 100) * scale : parseFloat(token);
}

export class TokenSet {
  constructor(private readonly vars: ReadonlyMap<string, string>) {}

  has(name: string): boolean {
    return this.vars.has(name);
  }

  raw(name: string): string {
    const v = this.vars.get(name);
    if (v === undefined) throw new Error(`Token ${name} is not defined`);
    return v;
  }

  with(overrides: ReadonlyMap<string, string>): TokenSet {
    return new TokenSet(new Map([...this.vars, ...overrides]));
  }

  color(nameOrValue: string): Rgba {
    const value = nameOrValue.startsWith('--') ? this.raw(nameOrValue) : nameOrValue;
    return this.evaluate(value, 0);
  }

  private evaluate(value: string, depth: number): Rgba {
    if (depth > 12) throw new Error(`Token cycle near "${value}"`);
    const v = value.trim();
    const variable = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
    if (variable) {
      const [, name, fallback] = variable;
      const target = this.vars.get(name!) ?? fallback;
      if (target === undefined) throw new Error(`Token ${name} is not defined`);
      return this.evaluate(target, depth + 1);
    }
    if (v === 'transparent') return [0, 0, 0, 0];
    if (v.startsWith('#')) return parseHex(v);
    const fn = /^(rgba?)\((.*)\)$/.exec(v);
    if (fn) {
      const [colorPart = '', alphaPart] = fn[2]!.includes('/') ? fn[2]!.split('/') : [fn[2]!];
      const channels = colorPart.split(/[\s,]+/).filter(Boolean);
      const alphaToken = alphaPart?.trim() ?? channels[3];
      const a = alphaToken === undefined ? 1 : parseChannel(alphaToken, 1);
      return [parseChannel(channels[0]!, 255), parseChannel(channels[1]!, 255), parseChannel(channels[2]!, 255), a];
    }
    const mix = /^color-mix\(\s*in srgb\s*,(.*)\)$/.exec(v);
    if (mix) {
      const [first = '', second = ''] = splitTop(mix[1]!, ',');
      const stop = (s: string): { color: Rgba; pct: number | null } => {
        const m = /^(.*?)(?:\s+(\d+(?:\.\d+)?)%)?$/.exec(s.trim())!;
        return { color: this.evaluate(m[1]!, depth + 1), pct: m[2] === undefined ? null : parseFloat(m[2]) / 100 };
      };
      const a = stop(first);
      const b = stop(second);
      const pa = a.pct ?? (b.pct === null ? 0.5 : 1 - b.pct);
      const pb = b.pct ?? 1 - pa;
      // Premultiplied interpolation, as CSS does for colour-mix().
      const alpha = a.color[3] * pa + b.color[3] * pb;
      if (alpha === 0) return [0, 0, 0, 0];
      const ch = (k: 0 | 1 | 2): number => (a.color[k] * a.color[3] * pa + b.color[k] * b.color[3] * pb) / alpha;
      return [ch(0), ch(1), ch(2), alpha];
    }
    throw new Error(`Cannot evaluate colour "${value}"`);
  }
}

/** Composites `fg` (with its own alpha, times `extraAlpha`) over an opaque backdrop. */
export function over(fg: Rgba, backdrop: Rgba, extraAlpha = 1): Rgba {
  const a = fg[3] * extraAlpha;
  return [
    fg[0] * a + backdrop[0] * (1 - a),
    fg[1] * a + backdrop[1] * (1 - a),
    fg[2] * a + backdrop[2] * (1 - a),
    1,
  ];
}

const lin = (v: number): number => {
  const s = clamp(v, 0, 255) / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function luminance(c: Rgba): number {
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** WCAG 2.x contrast ratio; both colours must be opaque (composite them first). */
export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ───────── the project's themes ─────────

export type ThemeName = 'night' | 'dawn';

export const MOODS = ['-3', '-2', '-1', '0', '1', '2', '3'] as const;

export interface LoadedThemes {
  night: TokenSet;
  dawn: TokenSet;
  /** Dawn as the stylesheet applies it automatically (no data-theme, light system scheme). */
  dawnAuto: TokenSet;
  /** Mood overrides for the aura (`--aura-a`, `--aura-c`) per theme and mood step. */
  mood: Record<ThemeName, Record<(typeof MOODS)[number], Map<string, string>>>;
  /** Raw declaration maps of the explicit dawn block and the automatic one, for the drift check. */
  dawnBlocks: { explicit: Map<string, string>; auto: Map<string, string> };
  /** Aura overrides per mood step as the automatic dawn rules apply them. */
  dawnAutoMood: Record<(typeof MOODS)[number], Map<string, string>>;
}

export function loadThemes(): LoadedThemes {
  const themeRules = parseCss(readStyle('themes.css'));
  const tokenRules = parseCss(readStyle('tokens.css'));
  const effectRules = parseCss(readStyle('effects.css'));

  const rootSel = [':root', ":root[data-theme='night']"];
  const dawnSel = [":root[data-theme='dawn']"];
  const autoSel = [':root:not([data-theme])'];
  const light = '(prefers-color-scheme: light)';

  const shared = new Map<string, string>([
    ...collect(tokenRules, [':root']),
    ...collect(effectRules, [':root']),
    ...collect(themeRules, rootSel),
  ]);
  const dawnExplicit = collect(themeRules, dawnSel);
  const dawnAuto = collect(themeRules, autoSel, light);

  const mood = { night: {}, dawn: {} } as LoadedThemes['mood'];
  const dawnAutoMood = {} as LoadedThemes['dawnAutoMood'];
  for (const m of MOODS) {
    mood.night[m] = collect(themeRules, [`[data-mood='${m}']`]);
    mood.dawn[m] = collect(themeRules, [`:root[data-theme='dawn'] [data-mood='${m}']`]);
    dawnAutoMood[m] = collect(themeRules, [`:root:not([data-theme]) [data-mood='${m}']`], light);
  }

  return {
    night: new TokenSet(shared),
    dawn: new TokenSet(new Map([...shared, ...dawnExplicit])),
    dawnAuto: new TokenSet(new Map([...shared, ...dawnAuto])),
    mood,
    dawnBlocks: { explicit: dawnExplicit, auto: dawnAuto },
    dawnAutoMood,
  };
}
