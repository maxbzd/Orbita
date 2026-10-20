import type { RouteObject } from 'react-router-dom';

/** «Поток» (SPEC §4.5). The heavy screen loads on demand. */
export const routes: RouteObject[] = [
  {
    path: 'stream',
    lazy: async () => ({ Component: (await import('./StreamScreen')).default }),
  },
];
