import type { RouteObject } from 'react-router';

// Kept apart from the other exports of this feature: the router needs only this, and must not pull the screen's logic (and what it
// imports) into the first download.
/** «Настройки» (SPEC §4.15). Deep link to a group: `/settings?section=ai`. */
export const routes: RouteObject[] = [
  {
    path: 'settings',
    lazy: async () => ({ Component: (await import('./SettingsScreen')).default }),
  },
];
