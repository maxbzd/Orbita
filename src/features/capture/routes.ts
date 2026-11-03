import type { RouteObject } from 'react-router';

// Kept apart from the other exports of this feature: the router needs only this, and must not pull the screen's logic (and what it
// imports) into the first download.
/**
 * The recording screen, `/capture` (full screen, outside the app shell). `?autostart=1` starts recording at once
 * (the PWA shortcut); `?mode=text` opens the text mode.
 */
export const routes: RouteObject[] = [
  {
    path: 'capture',
    lazy: async () => ({ Component: (await import('./CaptureScreen')).CaptureScreen }),
  },
];
