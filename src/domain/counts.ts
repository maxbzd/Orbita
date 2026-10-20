import { tn } from '../i18n';
import type { ItemKind } from './types';

/** "5 records" / "5 записей". One function per noun keeps every message a literal the i18n check can see. */
export const recordsCount = (n: number): string => tn(n, '{n} record', '{n} records');
export const daysCount = (n: number): string => tn(n, '{n} day', '{n} days');
export const wordsCount = (n: number): string => tn(n, '{n} word', '{n} words');
export const checkinsCount = (n: number): string => tn(n, '{n} check-in', '{n} check-ins');
export const mentionsCount = (n: number): string => tn(n, '{n} mention', '{n} mentions');
export const timesCount = (n: number): string => tn(n, '{n} time', '{n} times');
export const predictionsCount = (n: number): string => tn(n, '{n} prediction', '{n} predictions');
export const objectsCount = (n: number): string => tn(n, '{n} object', '{n} objects');
export const peopleCount = (n: number): string => tn(n, '{n} person', '{n} people');
export const hoursCount = (n: number): string => tn(n, '{n} hour', '{n} hours');
export const minutesCount = (n: number): string => tn(n, '{n} minute', '{n} minutes');
export const secondsCount = (n: number): string => tn(n, '{n} second', '{n} seconds');
export const closedPredictionsCount = (n: number): string => tn(n, '{n} closed prediction', '{n} closed predictions');
export const projectsCount = (n: number): string => tn(n, '{n} project', '{n} projects');

/** "2 decisions", "1 commitment": a count of items of one kind. */
export function itemKindCount(kind: ItemKind, n: number): string {
  switch (kind) {
    case 'decision':
      return tn(n, '{n} decision', '{n} decisions');
    case 'commitment':
      return tn(n, '{n} commitment', '{n} commitments');
    case 'idea':
      return tn(n, '{n} idea', '{n} ideas');
    case 'prediction':
      return predictionsCount(n);
    case 'task':
      return tn(n, '{n} task', '{n} tasks');
    case 'question':
      return tn(n, '{n} question', '{n} questions');
    case 'lesson':
      return tn(n, '{n} lesson', '{n} lessons');
    case 'fact':
      return tn(n, '{n} fact', '{n} facts');
  }
}
