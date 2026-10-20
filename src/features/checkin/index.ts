import type { RouteObject } from 'react-router-dom';

export { HIDE_FROM_AI_TAG, draftToCheckIn, wordsForMood } from './logic';

/** "Состояние": the check-in sheet. Also the target of the PWA shortcut `#/checkin`. */
export const routes: RouteObject[] = [
  {
    path: 'checkin',
    lazy: async () => ({ Component: (await import('./CheckInScreen')).default }),
  },
];
