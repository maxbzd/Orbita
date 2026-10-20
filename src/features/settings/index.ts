import type { RouteObject } from 'react-router-dom';

export { SECTIONS as SETTINGS_SECTIONS } from './sections';
export type { SectionId as SettingsSectionId } from './sections';

/** «Настройки» (SPEC §4.15). Deep link to a group: `/settings?section=ai`. */
export const routes: RouteObject[] = [
  {
    path: 'settings',
    lazy: async () => ({ Component: (await import('./SettingsScreen')).default }),
  },
];
