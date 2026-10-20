import type { RouteObject } from 'react-router-dom';

export { citationPath, historyOf, questionFromSearch, stripCodes } from './model';
export type { Turn } from './model';

/** «Спросить» (SPEC §4.12). `/ask?q=<вопрос>` asks at once. */
export const routes: RouteObject[] = [
  {
    path: 'ask',
    lazy: async () => ({ Component: (await import('./AskScreen')).default }),
  },
];
