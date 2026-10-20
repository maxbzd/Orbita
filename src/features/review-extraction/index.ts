import type { RouteObject } from 'react-router-dom';

/** `/review/:captureId`: processing state, «Нашёл N объектов», the card stack, errors. */
export const routes: RouteObject[] = [
  {
    path: 'review/:captureId',
    lazy: async () => ({ Component: (await import('./ReviewScreen')).ReviewScreen }),
  },
];
