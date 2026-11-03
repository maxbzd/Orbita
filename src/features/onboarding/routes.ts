import type { RouteObject } from 'react-router';

// Kept apart from the other exports of this feature: the router needs only this, and must not pull the screen's logic (and what it
// imports) into the first download.
/** "Знакомство": the first launch. */
export const routes: RouteObject[] = [
  {
    path: 'onboarding',
    lazy: async () => ({ Component: (await import('./OnboardingScreen')).default }),
  },
];
