import type { CaptureContext } from '../../domain/types';
import { t } from '../../i18n';

/** The context chips of the recording screen. They never affect the start. */
export const CONTEXT_CHOICES: ReadonlyArray<{ value: CaptureContext; label: string }> = [
  { value: 'walk', get label() { return t('Walk') } },
  { value: 'home', get label() { return t('At home') } },
  { value: 'transit', get label() { return t('On the way') } },
  { value: 'work', get label() { return t('Work') } },
];

export const CONTEXT_LABELS: Readonly<Record<CaptureContext, string>> = {
  get walk() { return t('Walk') },
  get home() { return t('At home') },
  get transit() { return t('On the way') },
  get work() { return t('Work') },
  get other() { return t('Other') },
};

/** At most this many projects are offered next to the contexts. */
export const PROJECT_CHIPS = 4;

/** The label of the collapsed chip. */
export function contextSummary(context: CaptureContext | null, projectNames: readonly string[]): string {
  const parts = [context ? CONTEXT_LABELS[context] : undefined, ...projectNames].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return t('Context');
  const [first, ...rest] = parts;
  return rest.length > 0 ? `${first} +${rest.length}` : (first ?? t('Context'));
}
