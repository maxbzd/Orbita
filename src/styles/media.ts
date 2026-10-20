import { useEffect, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';

/**
 * Environment hooks used by the design system: media queries, breakpoints, page visibility and
 * "is this element on screen". Every hook degrades gracefully where the browser API is missing
 * (jsdom has no matchMedia), so components render in unit tests without setup.
 */

export type Breakpoint = 'phone' | 'tablet' | 'desktop';

/** Lower bounds in CSS px. */
export const BREAKPOINTS = { tablet: 768, desktop: 1280 } as const;

export function breakpointFor(width: number): Breakpoint {
  if (width >= BREAKPOINTS.desktop) return 'desktop';
  if (width >= BREAKPOINTS.tablet) return 'tablet';
  return 'phone';
}

const hasMatchMedia = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** Subscribes to a media query; returns `fallback` where matchMedia does not exist. */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (!hasMatchMedia()) return () => undefined;
      const list = window.matchMedia(query);
      list.addEventListener('change', notify);
      return () => list.removeEventListener('change', notify);
    },
    () => (hasMatchMedia() ? window.matchMedia(query).matches : fallback),
    () => fallback,
  );
}

/**
 * phone < 768, tablet 768-1279, desktop >= 1280. Without matchMedia it follows `window.innerWidth`.
 */
export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window === 'undefined') return () => undefined;
      if (!hasMatchMedia()) {
        window.addEventListener('resize', notify);
        return () => window.removeEventListener('resize', notify);
      }
      const lists = [
        window.matchMedia(`(min-width: ${BREAKPOINTS.tablet}px)`),
        window.matchMedia(`(min-width: ${BREAKPOINTS.desktop}px)`),
      ];
      for (const list of lists) list.addEventListener('change', notify);
      return () => {
        for (const list of lists) list.removeEventListener('change', notify);
      };
    },
    () => {
      if (typeof window === 'undefined') return 'phone';
      if (!hasMatchMedia()) return breakpointFor(window.innerWidth);
      if (window.matchMedia(`(min-width: ${BREAKPOINTS.desktop}px)`).matches) return 'desktop';
      if (window.matchMedia(`(min-width: ${BREAKPOINTS.tablet}px)`).matches) return 'tablet';
      return 'phone';
    },
    () => 'phone',
  );
}

/** True while the tab is visible. Infinite animations must stop when it turns false. */
export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof document === 'undefined') return () => undefined;
      document.addEventListener('visibilitychange', notify);
      return () => document.removeEventListener('visibilitychange', notify);
    },
    () => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'),
    () => true,
  );
}

/**
 * True while the element intersects the viewport (IntersectionObserver). Without the API it is
 * always true, so nothing is wrongly frozen.
 */
export function useOnScreen(ref: RefObject<Element | null>, rootMargin = '0px'): boolean {
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setOnScreen(last.isIntersecting);
    }, { rootMargin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, rootMargin]);
  return onScreen;
}

/**
 * True while a real-blur layer (sheet, dialog) is open: useModalBehavior sets `data-overlay` on <html>.
 * Animated layers underneath pause, since blur over motion is the costliest combination on a phone.
 */
export function useOverlayOpen(): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => undefined;
      const observer = new MutationObserver(notify);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-overlay'] });
      return () => observer.disconnect();
    },
    () => (typeof document === 'undefined' ? false : document.documentElement.hasAttribute('data-overlay')),
    () => false,
  );
}
