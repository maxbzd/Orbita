import type { RouteObject } from 'react-router-dom';

/** «Я» (SPEC §4.14). The heavy screen loads on demand. */
export const routes: RouteObject[] = [
  {
    path: 'me',
    lazy: async () => ({ Component: (await import('./MeScreen')).default }),
  },
];
