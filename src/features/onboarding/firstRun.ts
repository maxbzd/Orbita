import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getSettings } from '../../db';
import { useFeed, useSettings } from '../../db/hooks';
import type { Settings } from '../../domain/types';

/** Paths that never bounce to the onboarding: the onboarding itself and the recording screen. */
export const FIRST_RUN_EXEMPT: readonly string[] = ['/onboarding', '/capture'];

export const ONBOARDING_PATH = '/onboarding';

const isExempt = (pathname: string): boolean => FIRST_RUN_EXEMPT.some((path) => pathname === path || pathname.startsWith(`${path}/`));

/**
 * Whether the first-run redirect applies: the onboarding was never finished and the user is not on an
 * exempt screen. Someone who already has records (data restored from a backup, demo data, the app
 * used before the onboarding existed) is not sent through it again.
 */
export function needsOnboarding({ settings, pathname, hasRecords }: { settings: Pick<Settings, 'onboarding'>; pathname: string; hasRecords: boolean }): boolean {
  return !settings.onboarding.done && !hasRecords && !isExempt(pathname);
}

/**
 * Sends a first launch to `/onboarding`. It waits for both answers (settings and "any record at all") so a
 * returning user never sees a flash of the onboarding.
 */
export function useFirstRunRedirect(): void {
  const settings = useSettings();
  const feed = useFeed({ limit: 1 });
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const ready = settings !== undefined && feed !== undefined;
  const redirect = ready && needsOnboarding({ settings, pathname, hasRecords: feed.length > 0 });

  // The live query can lag a moment behind a write made just before navigating away from the onboarding:
  // read the flag once more from the database before sending the user back.
  useEffect(() => {
    if (!redirect) return undefined;
    let cancelled = false;
    void getSettings().then((fresh) => {
      if (!cancelled && !fresh.onboarding.done) navigate(ONBOARDING_PATH, { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [redirect, navigate]);
}

/** Mounted once in the root layout. */
export function FirstRunRedirect(): null {
  useFirstRunRedirect();
  return null;
}
