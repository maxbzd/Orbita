import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { ThemeMode } from '../domain/types';
import { useMediaQuery } from './media';
import { t } from '../i18n';

/**
 * Theme, effect tier and motion preference.
 *
 * ThemeProvider writes four attributes on <html> (read by tokens.css / themes.css / effects.css):
 *   data-theme   night | dawn        (absent for "auto": the stylesheet follows the system scheme)
 *   data-effects auto | max | reduced | min     the user's choice
 *   data-quality high | mid | low               the resolved tier
 *   data-motion  full | reduced                 system setting OR the "less motion" switch
 *
 * The settings in IndexedDB are the source of truth. localStorage keeps a copy only so the first
 * paint is right before Dexie has loaded: nothing else may be stored there.
 */

export type ThemePreference = 'night' | 'dawn' | 'auto';
export type ResolvedTheme = 'night' | 'dawn';
export type EffectsPreference = 'auto' | 'max' | 'reduced' | 'min';
export type QualityTier = 'high' | 'mid' | 'low';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['night', 'dawn', 'auto'];
export const EFFECTS_PREFERENCES: readonly EffectsPreference[] = ['auto', 'max', 'reduced', 'min'];

export const THEME_LABELS: Record<ThemePreference, string> = { get night() { return t('Night') }, get dawn() { return t('Dawn') }, get auto() { return t('Same as system') } };
export const EFFECTS_LABELS: Record<EffectsPreference, string> = {
  get auto() { return t('Auto') },
  get max() { return t('Maximum') },
  get reduced() { return t('Reduced') },
  get min() { return t('Minimum') },
};

/** Browser UI colour (`<meta name="theme-color">`) per theme; equals `--bg-0` (checked by a test). */
export const THEME_COLORS: Record<ResolvedTheme, string> = { night: '#07080f', dawn: '#f6f3ec' };

/** Per-tier budgets for the heavy visuals. 0 = use the CSS fallback. */
export const TIER_BUDGETS: Record<
  QualityTier,
  { orbPoints: number; orbFps: number; peoplePoints: number; twinkleStars: number }
> = {
  high: { orbPoints: 1200, orbFps: 60, peoplePoints: 900, twinkleStars: 28 },
  mid: { orbPoints: 600, orbFps: 30, peoplePoints: 400, twinkleStars: 0 },
  low: { orbPoints: 0, orbFps: 0, peoplePoints: 0, twinkleStars: 0 },
};

// ───────── mapping to the stored setting (`Settings.theme`: auto | dark | light) ─────────

export function themeFromSettings(mode: ThemeMode): ThemePreference {
  if (mode === 'dark') return 'night';
  if (mode === 'light') return 'dawn';
  return 'auto';
}

export function themeToSettings(theme: ThemePreference): ThemeMode {
  if (theme === 'night') return 'dark';
  if (theme === 'dawn') return 'light';
  return 'auto';
}

// ───────── tier detection ─────────

export interface DeviceSignals {
  /** `navigator.deviceMemory` in GB (Chromium only; capped at 8). */
  deviceMemory?: number;
  hardwareConcurrency?: number;
  saveData?: boolean;
  reducedTransparency?: boolean;
}

/** Pure: maps device signals to a tier. Unknown signals never lower the tier. */
export function detectTier(signals: DeviceSignals): QualityTier {
  const { deviceMemory: mem, hardwareConcurrency: cores } = signals;
  if (signals.saveData || signals.reducedTransparency) return 'low';
  if ((mem !== undefined && mem <= 2) || (cores !== undefined && cores <= 2)) return 'low';
  if ((mem !== undefined && mem <= 4) || (cores !== undefined && cores <= 4)) return 'mid';
  return 'high';
}

const TIER_ORDER: readonly QualityTier[] = ['high', 'mid', 'low'];

/** Applies the user's choice; `auto` uses the detected tier lowered by `demotions` steps. */
export function resolveTier(preference: EffectsPreference, detected: QualityTier, demotions = 0): QualityTier {
  if (preference === 'max') return 'high';
  if (preference === 'reduced') return 'mid';
  if (preference === 'min') return 'low';
  const index = Math.min(TIER_ORDER.length - 1, TIER_ORDER.indexOf(detected) + Math.max(0, demotions));
  return TIER_ORDER[index]!;
}

interface NavigatorWithHints extends Navigator {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

export function readDeviceSignals(): DeviceSignals {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as NavigatorWithHints;
  const signals: DeviceSignals = {};
  if (typeof nav.deviceMemory === 'number') signals.deviceMemory = nav.deviceMemory;
  if (typeof nav.hardwareConcurrency === 'number' && nav.hardwareConcurrency > 0) {
    signals.hardwareConcurrency = nav.hardwareConcurrency;
  }
  if (nav.connection?.saveData) signals.saveData = true;
  return signals;
}

const queryMatches = (query: string): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;

// ───────── cache (localStorage) ─────────

export interface UiPreferences {
  theme: ThemePreference;
  effects: EffectsPreference;
  /** The "less motion" switch in settings. The system setting is read separately. */
  reduceMotion: boolean;
}

export const DEFAULT_PREFERENCES: UiPreferences = { theme: 'night', effects: 'auto', reduceMotion: false };

export const CACHE_KEYS = {
  theme: 'orbit:ui:theme',
  effects: 'orbit:ui:effects',
  reduceMotion: 'orbit:ui:reduce-motion',
} as const;

function cacheGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private mode, blocked storage, SSR
  }
}

function cacheSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // the cache is an optimisation only
  }
}

export function readCachedPreferences(): UiPreferences {
  const theme = cacheGet(CACHE_KEYS.theme);
  const effects = cacheGet(CACHE_KEYS.effects);
  const reduce = cacheGet(CACHE_KEYS.reduceMotion);
  return {
    theme: THEME_PREFERENCES.find((t) => t === theme) ?? DEFAULT_PREFERENCES.theme,
    effects: EFFECTS_PREFERENCES.find((e) => e === effects) ?? DEFAULT_PREFERENCES.effects,
    reduceMotion: reduce === '1',
  };
}

// ───────── writing to <html> ─────────

export interface AppliedState {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  effects: EffectsPreference;
  tier: QualityTier;
  motionReduced: boolean;
}

export function applyToDocument(state: AppliedState, root: HTMLElement = document.documentElement): void {
  if (state.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = state.theme;
  root.dataset.effects = state.effects;
  root.dataset.quality = state.tier;
  root.dataset.motion = state.motionReduced ? 'reduced' : 'full';

  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLORS[state.resolvedTheme];
}

function systemTheme(): ResolvedTheme {
  return queryMatches('(prefers-color-scheme: light)') ? 'dawn' : 'night';
}

/**
 * Applies the cached preferences before React renders (called when this module loads), so a
 * returning user never sees the wrong theme while Dexie opens.
 */
export function bootDocument(): void {
  if (typeof document === 'undefined') return;
  const prefs = readCachedPreferences();
  const detected = detectTier({ ...readDeviceSignals(), reducedTransparency: queryMatches('(prefers-reduced-transparency: reduce)') });
  applyToDocument({
    theme: prefs.theme,
    resolvedTheme: prefs.theme === 'auto' ? systemTheme() : prefs.theme,
    effects: prefs.effects,
    tier: resolveTier(prefs.effects, detected),
    motionReduced: prefs.reduceMotion || queryMatches('(prefers-reduced-motion: reduce)'),
  });
}

bootDocument();

// ───────── context ─────────

export interface ThemeContextValue extends UiPreferences {
  /** `theme` with "auto" resolved against the system scheme. */
  resolvedTheme: ResolvedTheme;
  /** The resolved quality tier. */
  tier: QualityTier;
  /** System prefers-reduced-motion OR the settings switch. */
  motionReduced: boolean;
  systemMotionReduced: boolean;
  setTheme(theme: ThemePreference): void;
  setEffects(effects: EffectsPreference): void;
  setReduceMotion(reduce: boolean): void;
  /** Lowers the automatic tier by one step (a frame-time probe found the device too slow). */
  demoteTier(): void;
}

const noop = (): void => undefined;

const DEFAULT_CONTEXT: ThemeContextValue = {
  ...DEFAULT_PREFERENCES,
  resolvedTheme: 'night',
  tier: 'high',
  motionReduced: false,
  systemMotionReduced: false,
  setTheme: noop,
  setEffects: noop,
  setReduceMotion: noop,
  demoteTier: noop,
};

const ThemeContext = createContext<ThemeContextValue>(DEFAULT_CONTEXT);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UiPreferences>(readCachedPreferences);
  const [demotions, setDemotions] = useState(0);

  const systemLight = useMediaQuery('(prefers-color-scheme: light)');
  const systemMotionReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const reducedTransparency = useMediaQuery('(prefers-reduced-transparency: reduce)');

  const detected = useMemo(() => detectTier({ ...readDeviceSignals(), reducedTransparency }), [reducedTransparency]);
  const tier = resolveTier(prefs.effects, detected, demotions);
  const resolvedTheme: ResolvedTheme = prefs.theme === 'auto' ? (systemLight ? 'dawn' : 'night') : prefs.theme;
  const motionReduced = systemMotionReduced || prefs.reduceMotion;

  useLayoutEffect(() => {
    applyToDocument({ theme: prefs.theme, resolvedTheme, effects: prefs.effects, tier, motionReduced });
  }, [prefs.theme, prefs.effects, resolvedTheme, tier, motionReduced]);

  const setTheme = useCallback((theme: ThemePreference) => {
    cacheSet(CACHE_KEYS.theme, theme);
    setPrefs((p) => (p.theme === theme ? p : { ...p, theme }));
  }, []);
  const setEffects = useCallback((effects: EffectsPreference) => {
    cacheSet(CACHE_KEYS.effects, effects);
    setPrefs((p) => (p.effects === effects ? p : { ...p, effects }));
  }, []);
  const setReduceMotion = useCallback((reduceMotion: boolean) => {
    cacheSet(CACHE_KEYS.reduceMotion, reduceMotion ? '1' : '0');
    setPrefs((p) => (p.reduceMotion === reduceMotion ? p : { ...p, reduceMotion }));
  }, []);
  const demoteTier = useCallback(() => setDemotions((n) => Math.min(n + 1, TIER_ORDER.length - 1)), []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      ...prefs,
      resolvedTheme,
      tier,
      motionReduced,
      systemMotionReduced,
      setTheme,
      setEffects,
      setReduceMotion,
      demoteTier,
    }),
    [prefs, resolvedTheme, tier, motionReduced, systemMotionReduced, setTheme, setEffects, setReduceMotion, demoteTier],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ───────── hooks ─────────

/** The theme preference (night | dawn | auto), the resolved theme, and a setter. */
export function useTheme(): {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme(theme: ThemePreference): void;
} {
  const { theme, resolvedTheme, setTheme } = useContext(ThemeContext);
  return { theme, resolvedTheme, setTheme };
}

/** Effect tier: the user's preference, the resolved tier, and the per-tier budgets of heavy visuals. */
export function useEffectsTier(): {
  preference: EffectsPreference;
  tier: QualityTier;
  budget: (typeof TIER_BUDGETS)[QualityTier];
  setPreference(preference: EffectsPreference): void;
  demote(): void;
} {
  const { effects, tier, setEffects, demoteTier } = useContext(ThemeContext);
  return { preference: effects, tier, budget: TIER_BUDGETS[tier], setPreference: setEffects, demote: demoteTier };
}

/** True when ambient motion must stay off: the system asks for it, or the user switched it on. */
export function useReducedMotion(): boolean {
  return useContext(ThemeContext).motionReduced;
}

/** The "less motion" switch itself, for the settings screen. */
export function useMotionPreference(): {
  reduceMotion: boolean;
  systemReduced: boolean;
  reduced: boolean;
  setReduceMotion(reduce: boolean): void;
} {
  const { reduceMotion, systemMotionReduced, motionReduced, setReduceMotion } = useContext(ThemeContext);
  return { reduceMotion, systemReduced: systemMotionReduced, reduced: motionReduced, setReduceMotion };
}
