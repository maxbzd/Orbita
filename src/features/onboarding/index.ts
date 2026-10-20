import type { RouteObject } from 'react-router-dom';

export { FIRST_RUN_EXEMPT, FirstRunRedirect, ONBOARDING_PATH, needsOnboarding } from './firstRun';

/** "Знакомство": the first launch. */
export const routes: RouteObject[] = [
  {
    path: 'onboarding',
    lazy: async () => ({ Component: (await import('./OnboardingScreen')).default }),
  },
];
