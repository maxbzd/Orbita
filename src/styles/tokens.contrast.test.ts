import { describe, expect, it } from 'vitest';
import { MOODS, contrast, loadThemes, over } from './cssTokens';
import type { Rgba, ThemeName, TokenSet } from './cssTokens';

/**
 * WCAG 2.x checks on the real stylesheets.
 * Rules under test:
 *   - ink and ink-2 hold 4.5:1 on every flat surface, on cards and on every aura peak;
 *   - ink-3 holds 4.5:1 on flat surfaces only (the docs forbid it over an aura);
 *   - control borders hold 3:1 (WCAG 1.4.11), the focus ring too;
 *   - the text on the cream/black button, the AI gradient, danger and accent fills holds 4.5:1;
 *   - statuses and record types are readable as text on the sky.
 */

const themes = loadThemes();
const BOTH: ThemeName[] = ['night', 'dawn'];

const rgb = (c: Rgba): string => `rgb(${c.slice(0, 3).map((v) => Math.round(v)).join(' ')})`;
const set = (theme: ThemeName): TokenSet => themes[theme];

/** The opaque colour of a token over `backdrop`. */
const solid = (t: TokenSet, token: string, backdrop: Rgba): Rgba => over(t.color(token), backdrop);

function flatSurfaces(t: TokenSet): Array<[string, Rgba]> {
  const bg0 = solid(t, '--bg-0', [0, 0, 0, 1]);
  const bg1 = solid(t, '--bg-1', [0, 0, 0, 1]);
  return [
    ['bg-0', bg0],
    ['bg-1', bg1],
    ['bg-2', solid(t, '--bg-2', bg1)],
    ['glass-solid', solid(t, '--glass-solid', bg1)],
    ['surface on bg-1', solid(t, '--surface', bg1)],
    ['surface-2 on bg-1', solid(t, '--surface-2', bg1)],
    ['surface on bg-0', solid(t, '--surface', bg0)],
    ['real glass over bg-0', solid(t, '--glass-bg', bg0)],
  ];
}

describe('token completeness', () => {
  const required = [
    '--bg-0', '--bg-1', '--bg-2', '--glass-solid', '--glass-bg', '--ink', '--ink-2', '--ink-3', '--ink-off',
    '--stroke', '--stroke-ui', '--surface', '--surface-2', '--cta-bg', '--cta-ink', '--focus', '--accent',
    '--on-accent', '--ai-1', '--ai-2', '--ai-3', '--ai-ink', '--ok', '--warn', '--danger', '--rec', '--on-danger',
    '--t-decision', '--t-commitment', '--t-idea', '--t-forecast', '--t-state', '--t-person', '--t-pattern',
    '--t-task', '--t-question', '--t-lesson', '--t-fact', '--m-n3', '--m-n2', '--m-n1', '--m-0', '--m-p1',
    '--m-p2', '--m-p3', '--aura-a', '--aura-b', '--aura-c', '--scrim', '--pill-active',
  ];

  it.each(BOTH)('%s defines every required token and each one evaluates', (name) => {
    for (const token of required) {
      expect(set(name).has(token), `${name}: ${token}`).toBe(true);
    }
    for (const token of required) expect(() => set(name).color(token), `${name}: ${token}`).not.toThrow();
  });

  it('the automatic dawn block repeats the explicit dawn block exactly', () => {
    expect([...themes.dawnBlocks.auto].sort()).toEqual([...themes.dawnBlocks.explicit].sort());
  });

  it('automatic dawn mood rules repeat the explicit ones', () => {
    for (const m of MOODS) {
      expect([...themes.dawnAutoMood[m]].sort(), `mood ${m}`).toEqual([...themes.mood.dawn[m]].sort());
    }
  });

  it('every mood defines the aura core and partner in both themes', () => {
    for (const theme of BOTH) {
      for (const m of MOODS) {
        const decls = themes.mood[theme][m];
        expect(decls.has('--aura-a'), `${theme} ${m} --aura-a`).toBe(true);
        expect(decls.has('--aura-c'), `${theme} ${m} --aura-c`).toBe(true);
      }
    }
  });
});

describe.each(BOTH)('%s: text on flat surfaces', (name) => {
  const t = set(name);

  it.each(flatSurfaces(t))('ink and ink-2 hold 4.5:1 on %s', (_label, bg) => {
    expect(contrast(t.color('--ink'), bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(solid(t, '--ink-2', bg), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(flatSurfaces(t))('ink-3 holds 4.5:1 on %s', (_label, bg) => {
    expect(contrast(solid(t, '--ink-3', bg), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('ink-off stays clearly weaker than ink-3 (it is for disabled controls only)', () => {
    const bg = solid(t, '--bg-0', [0, 0, 0, 1]);
    expect(contrast(t.color('--ink-off'), bg)).toBeLessThan(contrast(t.color('--ink-3'), bg));
  });
});

/**
 * Surfaces under the aura at the peak of each layer on its own: bare, under a card, under a glass
 * panel. How the layers overlap across the screen is checked against the real gradient geometry in
 * src/ui/backdrop/aura.contrast.test.ts.
 */
function auraBackdrops(name: ThemeName, mood: (typeof MOODS)[number]): Array<[string, Rgba]> {
  const t = set(name).with(themes.mood[name][mood]);
  const out: Array<[string, Rgba]> = [];
  for (const skyToken of ['--bg-0', '--bg-1']) {
    const sky = solid(t, skyToken, [0, 0, 0, 1]);
    for (const layer of ['--aura-a', '--aura-b', '--aura-c']) {
      const peak = over(t.color(layer), sky);
      out.push([`${layer} peak on ${skyToken}, bare`, peak]);
      out.push([`${layer} peak on ${skyToken}, card`, over(t.color('--surface'), peak)]);
      out.push([`${layer} peak on ${skyToken}, glass panel`, over(t.color('--glass-bg'), peak)]);
    }
  }
  return out;
}

describe.each(BOTH)('%s: ink and ink-2 over the aura', (name) => {
  const t0 = set(name);
  for (const mood of MOODS) {
    const cases = auraBackdrops(name, mood);
    it.each(cases)(`mood ${mood}: ink on %s`, (_label, bg) => {
      expect(contrast(t0.color('--ink'), bg)).toBeGreaterThanOrEqual(4.5);
    });
    it.each(cases)(`mood ${mood}: ink-2 on %s`, (label, bg) => {
      // Night: ink-2 is 8:1+ even at the brightest peak. Dawn: ink-2 was 4.1 on the lilac peak
      // before the fix in themes.css.
      expect(contrast(solid(t0, '--ink-2', bg), bg), `${label} ${rgb(bg)}`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe.each(BOTH)('%s: controls, fills and statuses', (name) => {
  const t = set(name);
  const bg0 = solid(t, '--bg-0', [0, 0, 0, 1]);
  const bg1 = solid(t, '--bg-1', [0, 0, 0, 1]);

  it('control borders hold 3:1 on the sky and on a card', () => {
    for (const bg of [bg0, bg1, solid(t, '--surface', bg1), solid(t, '--glass-solid', bg1)]) {
      expect(contrast(solid(t, '--stroke-ui', bg), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('the focus ring holds 3:1 on the sky, a card and the bright aura', () => {
    for (const bg of [bg0, bg1, solid(t, '--surface', bg1), solid(t, '--bg-2', bg1)]) {
      expect(contrast(t.color('--focus'), bg)).toBeGreaterThanOrEqual(3);
    }
  });

  it('main button text holds 4.5:1 on its fill', () => {
    expect(contrast(t.color('--cta-ink'), t.color('--cta-bg'))).toBeGreaterThanOrEqual(7);
  });

  it('dark AI text holds 4.5:1 on all three AI gradient stops', () => {
    for (const stop of ['--ai-1', '--ai-2', '--ai-3']) {
      expect(contrast(t.color('--ai-ink'), t.color(stop)), stop).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('danger and accent fills carry readable text', () => {
    expect(contrast(t.color('--on-danger'), t.color('--danger'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t.color('--on-accent'), t.color('--accent'))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['--ok', '--warn', '--danger', '--rec'])('status %s is readable as text on the sky and on a card', (token) => {
    for (const bg of [bg0, bg1, solid(t, '--surface', bg1)]) {
      expect(contrast(t.color(token), bg), token).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    '--t-decision', '--t-commitment', '--t-idea', '--t-forecast', '--t-state', '--t-person', '--t-pattern',
    '--t-task', '--t-question', '--t-lesson', '--t-fact',
  ])('type colour %s is readable on the sky and on a card', (token) => {
    for (const bg of [bg0, bg1, solid(t, '--surface', bg1)]) {
      expect(contrast(t.color(token), bg), token).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('night: documented figures hold', () => {
  const t = set('night');
  const bg0 = solid(t, '--bg-0', [0, 0, 0, 1]);

  it('record types keep the >= 8.3:1 promised by the design', () => {
    for (const token of [
      '--t-decision', '--t-commitment', '--t-idea', '--t-forecast', '--t-state', '--t-person', '--t-pattern',
      '--t-task', '--t-question', '--t-lesson', '--t-fact',
    ]) {
      expect(contrast(t.color(token), bg0), token).toBeGreaterThanOrEqual(8.3);
    }
  });

  it('mood colours hold 3:1 as shapes on the sky', () => {
    for (const token of ['--m-n3', '--m-n2', '--m-n1', '--m-0', '--m-p1', '--m-p2', '--m-p3']) {
      expect(contrast(t.color(token), bg0), token).toBeGreaterThanOrEqual(3);
    }
  });

  it('the headline figures of §2.3 are reproduced', () => {
    const sky = solid(t, '--bg-1', [0, 0, 0, 1]);
    expect(contrast(t.color('--ink'), sky)).toBeCloseTo(16.8, 0);
    expect(contrast(t.color('--ink-2'), sky)).toBeCloseTo(10.0, 0);
    expect(contrast(t.color('--ink-3'), sky)).toBeCloseTo(6.3, 0);
    expect(contrast(t.color('--cta-ink'), t.color('--cta-bg'))).toBeCloseTo(15.5, 0);
  });
});

describe('dawn: documented figures hold', () => {
  const t = set('dawn');
  const paper = solid(t, '--bg-0', [0, 0, 0, 1]);

  it('ink on paper is 16:1', () => {
    expect(contrast(t.color('--ink'), paper)).toBeCloseTo(16.0, 0);
  });

  it('the focus colour and the accent are the same indigo', () => {
    expect(t.raw('--focus')).toBe(t.raw('--accent'));
  });
});
