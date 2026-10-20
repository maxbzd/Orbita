/** Theme, effect tiers, motion and environment hooks. Tokens themselves are CSS (global.css). */
export {
  CACHE_KEYS,
  DEFAULT_PREFERENCES,
  EFFECTS_LABELS,
  EFFECTS_PREFERENCES,
  THEME_COLORS,
  THEME_LABELS,
  THEME_PREFERENCES,
  TIER_BUDGETS,
  ThemeProvider,
  applyToDocument,
  detectTier,
  readCachedPreferences,
  readDeviceSignals,
  resolveTier,
  themeFromSettings,
  themeToSettings,
  useEffectsTier,
  useMotionPreference,
  useReducedMotion,
  useTheme,
} from './theme';
export type {
  DeviceSignals,
  EffectsPreference,
  QualityTier,
  ResolvedTheme,
  ThemeContextValue,
  ThemePreference,
  UiPreferences,
} from './theme';
export { BREAKPOINTS, breakpointFor, useBreakpoint, useDocumentVisible, useMediaQuery, useOnScreen, useOverlayOpen } from './media';
export type { Breakpoint } from './media';
export { loadItalicFonts, loadPosterFont } from './fonts';
