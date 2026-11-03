import type { RouteObject } from 'react-router';

// Kept apart from the other exports of this feature: the router needs only this, and must not pull the screen's logic (and what it
// imports) into the first download.
/** "Состояние": the check-in sheet. Also the target of the PWA shortcut `#/checkin`. */
export const routes: RouteObject[] = [
  {
    path: 'checkin',
    lazy: async () => ({ Component: (await import('./CheckInScreen')).default }),
  },
];
