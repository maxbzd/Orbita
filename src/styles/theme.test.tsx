import { act, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadThemes } from './cssTokens';
import { installMatchMedia } from './mockMatchMedia';
import type { MatchMediaControl } from './mockMatchMedia';
import {
  CACHE_KEYS,
  THEME_COLORS,
  ThemeProvider,
  detectTier,
  readCachedPreferences,
  resolveTier,
  themeFromSettings,
  themeToSettings,
  useEffectsTier,
  useMotionPreference,
  useReducedMotion,
  useTheme,
} from './theme';

const html = document.documentElement;

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

let media: MatchMediaControl | undefined;
const originalCores = Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency');

beforeEach(() => {
  window.localStorage.clear();
  for (const attr of ['theme', 'effects', 'quality', 'motion']) delete html.dataset[attr];
  // The test machine's core count must not decide the tier: pretend to be a capable device.
  Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
});
afterEach(() => {
  media?.restore();
  media = undefined;
  Reflect.deleteProperty(navigator, 'hardwareConcurrency');
  if (originalCores) Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', originalCores);
});

describe('detectTier', () => {
  it('is high when nothing is known (Safari reports neither memory nor save-data)', () => {
    expect(detectTier({})).toBe('high');
  });

  it.each([
    [{ deviceMemory: 8, hardwareConcurrency: 8 }, 'high'],
    [{ deviceMemory: 4 }, 'mid'],
    [{ hardwareConcurrency: 4 }, 'mid'],
    [{ deviceMemory: 8, hardwareConcurrency: 4 }, 'mid'],
    [{ deviceMemory: 2 }, 'low'],
    [{ deviceMemory: 0.5 }, 'low'],
    [{ hardwareConcurrency: 2 }, 'low'],
    [{ deviceMemory: 8, saveData: true }, 'low'],
    [{ deviceMemory: 8, hardwareConcurrency: 8, reducedTransparency: true }, 'low'],
  ] as const)('%j -> %s', (signals, expected) => {
    expect(detectTier(signals)).toBe(expected);
  });
});

describe('resolveTier', () => {
  it('manual choices override detection', () => {
    expect(resolveTier('max', 'low')).toBe('high');
    expect(resolveTier('reduced', 'high')).toBe('mid');
    expect(resolveTier('min', 'high')).toBe('low');
  });

  it('auto follows detection and steps down with demotions, never below low', () => {
    expect(resolveTier('auto', 'high')).toBe('high');
    expect(resolveTier('auto', 'high', 1)).toBe('mid');
    expect(resolveTier('auto', 'high', 2)).toBe('low');
    expect(resolveTier('auto', 'mid', 5)).toBe('low');
  });

  it('demotions never touch a manual choice', () => {
    expect(resolveTier('max', 'high', 2)).toBe('high');
  });
});

describe('settings mapping', () => {
  it('maps the stored dark/light/auto to night/dawn/auto and back', () => {
    expect(themeFromSettings('dark')).toBe('night');
    expect(themeFromSettings('light')).toBe('dawn');
    expect(themeFromSettings('auto')).toBe('auto');
    for (const mode of ['dark', 'light', 'auto'] as const) {
      expect(themeToSettings(themeFromSettings(mode))).toBe(mode);
    }
  });
});

describe('cache', () => {
  it('falls back to the defaults on empty or garbage storage', () => {
    expect(readCachedPreferences()).toEqual({ theme: 'night', effects: 'auto', reduceMotion: false });
    window.localStorage.setItem(CACHE_KEYS.theme, 'purple');
    window.localStorage.setItem(CACHE_KEYS.effects, 'ultra');
    expect(readCachedPreferences()).toEqual({ theme: 'night', effects: 'auto', reduceMotion: false });
  });

  it('survives a storage that throws', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('blocked');
    };
    try {
      expect(readCachedPreferences().theme).toBe('night');
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe('ThemeProvider', () => {
  it('starts from the cached preferences and writes them to <html>', () => {
    window.localStorage.setItem(CACHE_KEYS.theme, 'dawn');
    window.localStorage.setItem(CACHE_KEYS.effects, 'reduced');
    render(<ThemeProvider>x</ThemeProvider>);
    expect(html.dataset.theme).toBe('dawn');
    expect(html.dataset.effects).toBe('reduced');
    expect(html.dataset.quality).toBe('mid');
    expect(html.dataset.motion).toBe('full');
  });

  it('setTheme updates the attribute and the cache; auto removes the attribute', () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe('night');
    expect(html.dataset.theme).toBe('night');

    act(() => result.current.setTheme('dawn'));
    expect(html.dataset.theme).toBe('dawn');
    expect(window.localStorage.getItem(CACHE_KEYS.theme)).toBe('dawn');
    expect(result.current.resolvedTheme).toBe('dawn');

    act(() => result.current.setTheme('auto'));
    expect(html.dataset.theme).toBeUndefined();
    expect(window.localStorage.getItem(CACHE_KEYS.theme)).toBe('auto');
  });

  it('auto resolves against the system scheme live', () => {
    media = installMatchMedia({ width: 390 });
    window.localStorage.setItem(CACHE_KEYS.theme, 'auto');
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.resolvedTheme).toBe('night');
    act(() => media!.setFeature('prefers-color-scheme', 'light'));
    expect(result.current.resolvedTheme).toBe('dawn');
    expect(html.dataset.theme).toBeUndefined();
    expect(document.querySelector('meta[name="theme-color"]')).toBeNull(); // none in jsdom: no throw
  });

  it('keeps <meta name="theme-color"> in step with the resolved theme', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#000000';
    document.head.append(meta);
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => result.current.setTheme('dawn'));
    expect(meta.content).toBe(THEME_COLORS.dawn);
    act(() => result.current.setTheme('night'));
    expect(meta.content).toBe(THEME_COLORS.night);
    meta.remove();
  });

  it('the theme-color constants equal --bg-0 of each theme', () => {
    const themes = loadThemes();
    expect(THEME_COLORS.night).toBe(themes.night.raw('--bg-0'));
    expect(THEME_COLORS.dawn).toBe(themes.dawn.raw('--bg-0'));
  });

  it('works without a provider (defaults, no-op setters)', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('night');
    expect(() => result.current.setTheme('dawn')).not.toThrow();
  });
});

describe('useEffectsTier', () => {
  it('manual preference sets data-quality and the budget', () => {
    const { result } = renderHook(() => useEffectsTier(), { wrapper });
    act(() => result.current.setPreference('min'));
    expect(html.dataset.quality).toBe('low');
    expect(html.dataset.effects).toBe('min');
    expect(result.current.tier).toBe('low');
    expect(result.current.budget.orbPoints).toBe(0);

    act(() => result.current.setPreference('max'));
    expect(html.dataset.quality).toBe('high');
    expect(result.current.budget).toMatchObject({ orbPoints: 1200, orbFps: 60 });

    act(() => result.current.setPreference('reduced'));
    expect(result.current.budget).toMatchObject({ orbPoints: 600, orbFps: 30 });
    expect(window.localStorage.getItem(CACHE_KEYS.effects)).toBe('reduced');
  });

  it('reads device signals in auto mode', () => {
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 2 });
    try {
      const { result } = renderHook(() => useEffectsTier(), { wrapper });
      expect(result.current.preference).toBe('auto');
      expect(result.current.tier).toBe('low');
      expect(html.dataset.quality).toBe('low');
    } finally {
      Reflect.deleteProperty(navigator, 'deviceMemory');
    }
  });

  it('prefers-reduced-transparency lowers the automatic tier', () => {
    media = installMatchMedia({ features: { 'prefers-reduced-transparency': 'reduce' } });
    const { result } = renderHook(() => useEffectsTier(), { wrapper });
    expect(result.current.tier).toBe('low');
  });

  it('demote() steps the automatic tier down once per call and ignores a manual choice', () => {
    const { result } = renderHook(() => useEffectsTier(), { wrapper });
    expect(result.current.tier).toBe('high');
    act(() => result.current.demote());
    expect(result.current.tier).toBe('mid');
    act(() => result.current.demote());
    act(() => result.current.demote());
    expect(result.current.tier).toBe('low');
    act(() => result.current.setPreference('max'));
    expect(result.current.tier).toBe('high');
  });
});

describe('useReducedMotion', () => {
  it('is false by default and follows the settings switch', () => {
    const { result } = renderHook(() => ({ reduced: useReducedMotion(), pref: useMotionPreference() }), { wrapper });
    expect(result.current.reduced).toBe(false);
    expect(html.dataset.motion).toBe('full');
    act(() => result.current.pref.setReduceMotion(true));
    expect(result.current.reduced).toBe(true);
    expect(html.dataset.motion).toBe('reduced');
    expect(window.localStorage.getItem(CACHE_KEYS.reduceMotion)).toBe('1');
  });

  it('follows the system setting and cannot be overridden by the switch', () => {
    media = installMatchMedia({ features: { 'prefers-reduced-motion': 'reduce' } });
    const { result } = renderHook(() => ({ reduced: useReducedMotion(), pref: useMotionPreference() }), { wrapper });
    expect(result.current.reduced).toBe(true);
    expect(result.current.pref.systemReduced).toBe(true);
    expect(result.current.pref.reduceMotion).toBe(false);
    expect(html.dataset.motion).toBe('reduced');
    act(() => media!.setFeature('prefers-reduced-motion', null));
    expect(result.current.reduced).toBe(false);
  });

  it('is rendered state, not just an attribute', () => {
    function Probe() {
      return <p>{useReducedMotion() ? 'calm' : 'lively'}</p>;
    }
    render(<Probe />, { wrapper });
    expect(screen.getByText('lively')).toBeInTheDocument();
  });
});
