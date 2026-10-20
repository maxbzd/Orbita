import type { RouteObject } from 'react-router-dom';

/** «Коллекции» (SPEC §4.8): `/items` and `/items/:kind` (a kind is `commitment`, `decision`, …). Screens load on demand. */
export const routes: RouteObject[] = [
  {
    path: 'items',
    lazy: async () => ({ Component: (await import('./CollectionsScreen')).default }),
  },
  {
    path: 'items/:kind',
    lazy: async () => ({ Component: (await import('./KindScreen')).default }),
  },
];
