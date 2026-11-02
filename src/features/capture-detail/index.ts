import type { RouteObject } from 'react-router';

/** «Запись (детально)» (SPEC §4.6). The heavy screen loads on demand. */
export const routes: RouteObject[] = [
  {
    path: 'entry/:captureId',
    lazy: async () => ({ Component: (await import('./EntryScreen')).default }),
  },
];
