import type { RouteObject } from 'react-router';

/** "Сегодня": the home screen. The screen is loaded on demand. */
export const routes: RouteObject[] = [
  {
    path: 'today',
    lazy: async () => ({ Component: (await import('./TodayScreen')).default }),
  },
];
