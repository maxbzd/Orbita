import type { RouteObject } from 'react-router-dom';

/** "Обзоры" (`/reviews`, `/reviews/:reviewId`) and the Android share target (`/share`). Screens are loaded on demand. */
export const routes: RouteObject[] = [
  { path: 'reviews', lazy: async () => ({ Component: (await import('./ReviewsScreen')).default }) },
  { path: 'reviews/:reviewId', lazy: async () => ({ Component: (await import('./ReviewViewScreen')).default }) },
  { path: 'share', lazy: async () => ({ Component: (await import('./ShareScreen')).default }) },
];
