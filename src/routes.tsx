import { Navigate, createHashRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { App, NotFound, RouteError } from './App';
import { routes as askRoutes } from './features/ask';
import { routes as captureRoutes } from './features/capture';
import { routes as captureDetailRoutes } from './features/capture-detail';
import { routes as checkinRoutes } from './features/checkin';
import { routes as contextRoutes } from './features/context';
import { routes as itemsRoutes } from './features/items';
import { routes as meRoutes } from './features/me';
import { routes as orbitRoutes } from './features/orbit';
import { routes as onboardingRoutes } from './features/onboarding';
import { routes as reviewsRoutes } from './features/reviews';
import { routes as peopleRoutes } from './features/people';
import { routes as reviewRoutes } from './features/review-extraction';
import { routes as settingsRoutes } from './features/settings';
import { routes as streamRoutes } from './features/stream';
import { routes as todayRoutes } from './features/today';
import { FullscreenLayout, RoutedShell } from './ui/shell';

/**
 * Route table. Each feature (docs/ARCHITECTURE.md) owns `export const routes: RouteObject[]` in its
 * `features/<name>/index.ts`, with the heavy screens behind `lazy`. Until a feature lands, its
 * entries here are placeholders; replace a feature's `placeholders(...)` call with the real
 * `...routes` from the feature, keeping the paths below (the PWA shortcuts and the Android share
 * target depend on `/capture`, `/checkin` and `/share`).
 *
 * Layout: every screen renders inside the app shell (navigation, backdrop, palette) except `/capture`,
 * which is full screen with no navigation.
 */

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    errorElement: <RouteError />,
    // Shown while the first lazy screen loads (the app unlocks first, so the router may be asked to render before it is ready).
    HydrateFallback: () => null,
    children: [
      { index: true, element: <Navigate to="/today" replace /> },
      {
        // Screens inside the shell.
        element: <RoutedShell />,
        children: [
          ...onboardingRoutes,
          ...todayRoutes,
          ...checkinRoutes,
          ...reviewRoutes,
          ...streamRoutes,
          ...captureDetailRoutes,
          ...orbitRoutes,
          ...itemsRoutes,
          ...peopleRoutes,
          ...reviewsRoutes,
          ...askRoutes,
          ...contextRoutes,
          ...meRoutes,
          ...settingsRoutes,
          { path: '*', element: <NotFound /> },
        ],
      },
      {
        // Full screen, no navigation: the recording screen.
        element: <FullscreenLayout />,
        children: captureRoutes,
      },
    ],
  },
];

/** Hash routing works on any static host and in PWA shortcuts (`#/capture?autostart=1`). */
export const router = createHashRouter(routes);
