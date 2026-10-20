import type { RouteObject } from 'react-router-dom';

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

export { useCaptureShell } from './shell';
export type { CaptureShell } from './shell';
