import type { RouteObject } from 'react-router';

// Kept apart from the other exports of this feature: the router needs only this, and must not pull the screen's logic (and what it
// imports) into the first download.
/** «Спросить» (SPEC §4.12). `/ask?q=<вопрос>` asks at once. */
export const routes: RouteObject[] = [
  {
    path: 'ask',
    lazy: async () => ({ Component: (await import('./AskScreen')).default }),
  },
];
