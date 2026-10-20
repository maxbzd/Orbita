import type { ItemKind } from '../../domain/types';
import type { IconName } from '../icons';
import { t } from '../../i18n';

/**
 * The record types the interface colours and labels: the eight item kinds plus the three
 * non-item "things" that also carry a type colour.
 */
export type TypeKind = ItemKind | 'state' | 'person' | 'pattern' | 'project';

export const TYPE_KINDS: readonly TypeKind[] = [
  'decision',
  'commitment',
  'idea',
  'prediction',
  'task',
  'question',
  'lesson',
  'fact',
  'state',
  'person',
  'pattern',
  'project',
];

export const TYPE_LABELS: Record<TypeKind, string> = {
  get decision() { return t('Decision') },
  get commitment() { return t('Commitment') },
  get idea() { return t('Idea') },
  get prediction() { return t('Prediction') },
  get task() { return t('Task') },
  get question() { return t('Question') },
  get lesson() { return t('Lesson') },
  get fact() { return t('Fact') },
  get state() { return t('State') },
  get person() { return t('Person') },
  get pattern() { return t('Pattern') },
  get project() { return t('Project') },
};

/** Plural forms for filter chips ("Решения", "Обязательства"). */
export const TYPE_LABELS_PLURAL: Record<TypeKind, string> = {
  get decision() { return t('Decisions', undefined, 'kinds') },
  get commitment() { return t('Commitments') },
  get idea() { return t('Ideas', undefined, 'kinds') },
  get prediction() { return t('Predictions') },
  get task() { return t('Tasks') },
  get question() { return t('Questions') },
  get lesson() { return t('Lessons') },
  get fact() { return t('Facts') },
  get state() { return t('States') },
  get person() { return t('People') },
  get pattern() { return t('Patterns') },
  get project() { return t('Projects') },
};

/** Every type has its own glyph: colour alone never carries the meaning. */
export const TYPE_ICONS: Record<TypeKind, IconName> = {
  decision: 'decision',
  commitment: 'commitment',
  idea: 'idea',
  prediction: 'prediction',
  task: 'task',
  question: 'question',
  lesson: 'lesson',
  fact: 'fact',
  state: 'state',
  person: 'person',
  pattern: 'pattern',
  project: 'project',
};

/** CSS colour for a type (a token reference, so it follows the theme). */
export function typeColor(kind: TypeKind): string {
  return `var(--t-${kind})`;
}
