import type { RouteObject } from 'react-router-dom';

export { budgetState, defaultDraft, draftFromPreset, draftToOptions, personFromSearch, presetFromDraft, toggleSection } from './model';
export type { ContextDraft } from './model';

/** «Контекст для ИИ» (SPEC §4.13). Deep link for one person: `/context?person=<id>`. */
export const routes: RouteObject[] = [
  {
    path: 'context',
    lazy: async () => ({ Component: (await import('./ContextScreen')).default }),
  },
];
