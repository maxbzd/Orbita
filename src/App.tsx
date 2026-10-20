import { useEffect } from 'react';
import { Link, Outlet, isRouteErrorResponse, useLocation, useRouteError } from 'react-router-dom';
import { LockGate } from './features/lock';
import { FirstRunRedirect } from './features/onboarding/firstRun';
import { useSettings } from './db/hooks';
import { documentTitleFor } from './lib/documentTitle';
import { startCloud } from './sync';
import { ThemeProvider, themeFromSettings, useEffectsTier, useMotionPreference, useTheme } from './styles';
import { Body, Display, ToastProvider } from './ui/primitives';
import styles from './App.module.css';
import { t } from './i18n';

/**
 * Applies the looks stored in the settings: theme, effect tier, "less motion" (IndexedDB is the source of truth).
 * Until Dexie answers, the values cached by ThemeProvider in localStorage are already on <html>, so there is no flash.
 */
function SettingsSync() {
  const settings = useSettings();
  const { setTheme } = useTheme();
  const { setPreference: setEffects } = useEffectsTier();
  const { setReduceMotion } = useMotionPreference();
  const mode = settings?.theme;
  const effects = settings?.ui.effects;
  const reduceMotion = settings?.ui.reduceMotion;
  useEffect(() => {
    if (mode) setTheme(themeFromSettings(mode));
  }, [mode, setTheme]);
  useEffect(() => {
    if (effects) setEffects(effects);
  }, [effects, setEffects]);
  useEffect(() => {
    if (reduceMotion !== undefined) setReduceMotion(reduceMotion);
  }, [reduceMotion, setReduceMotion]);
  return null;
}

/** Resumes cloud sync when the device is signed in (a no-op, and no network, when it is not). */
function CloudStart() {
  useEffect(() => {
    void startCloud();
  }, []);
  return null;
}

/** Keeps the tab title in step with the screen (history, task switcher, screen readers). */
function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = documentTitleFor(pathname);
  }, [pathname]);
  return null;
}

/** Root layout: theme, effect tier, toasts; the routed shell or screen goes in the outlet. */
export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <LockGate>
          <SettingsSync />
          <DocumentTitle />
          <CloudStart />
          <FirstRunRedirect />
          <Outlet />
        </LockGate>
      </ToastProvider>
    </ThemeProvider>
  );
}

/** Error boundary of the route tree: a screen threw, or the router could not match the URL. */
export function RouteError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <ThemeProvider>
        <main>
          <NotFound />
        </main>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <main className={styles.page}>
        <Display as="h1" size="l" className={styles.title}>
          {t('Something went wrong')}
        </Display>
        <Body tone="muted" className={styles.muted}>
          {t('Your data on this device is safe. Try reloading the app.')}
        </Body>
        <Link to="/today" className={styles.home}>
          {t('Go home')}
        </Link>
      </main>
    </ThemeProvider>
  );
}

/** Rendered inside the shell for an unknown URL (and by the error boundary for a 404). */
export function NotFound() {
  return (
    <div className={styles.page}>
      <Display as="h1" size="l" className={styles.title}>
        {t('There is no such page')}
      </Display>
      <Link to="/today" className={styles.home}>
        {t('Go home')}
      </Link>
    </div>
  );
}
