import type { RouteObject } from 'react-router';

// Kept apart from the other exports of this feature: the router needs only this, and must not pull the screen's logic (and what it
// imports) into the first download.
/** «Контекст для ИИ» (SPEC §4.13). Deep link for one person: `/context?person=<id>`. */
export const routes: RouteObject[] = [
  {
    path: 'context',
    lazy: async () => ({ Component: (await import('./ContextScreen')).default }),
  },
];
