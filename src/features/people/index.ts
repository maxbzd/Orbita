import type { RouteObject } from 'react-router-dom';

/** Карточка человека (SPEC §4.9). The list itself is the «Люди» segment of the orbit screen (`/people`). */
export const routes: RouteObject[] = [
  {
    path: 'people/:personId',
    lazy: async () => ({ Component: (await import('./PersonScreen')).default }),
  },
];
