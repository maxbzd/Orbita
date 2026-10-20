import { createElement } from 'react';
import type { RouteObject } from 'react-router-dom';
import type { OrbitTab } from './model';

/** The screen on a fixed segment, for the paths that have their own entry in the sidebar. */
function onTab(tab?: OrbitTab): NonNullable<RouteObject['lazy']> {
  return async () => {
    const { OrbitScreen } = await import('./OrbitScreen');
    return { Component: () => createElement(OrbitScreen, tab ? { fixedTab: tab } : {}) };
  };
}

/**
 * «Орбита» (SPEC §4.7): `/orbit?tab=time|people|patterns`. `/people` and `/patterns` show the same
 * screen on the matching segment; the person card is `/people/:personId` (see features/people).
 */
export const routes: RouteObject[] = [
  { path: 'orbit', lazy: onTab() },
  { path: 'people', lazy: onTab('people') },
  { path: 'patterns', lazy: onTab('patterns') },
];
