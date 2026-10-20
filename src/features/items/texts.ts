import type { ItemKind } from '../../domain/types';
import { t } from '../../i18n';

/** Empty states of the lists: one phrase, no jokes. */
export const EMPTY_TEXT: Record<ItemKind, { title: string; description: string }> = {
  commitment: { get title() { return t('No open promises.') }, get description() { return t('They will appear from your records when you say “promised” or “I owe”. You can also add them by hand.') } },
  decision: { get title() { return t('No decisions yet.') }, get description() { return t('Name a decision in a record or add one yourself: after a while I will ask how it turned out.') } },
  prediction: { get title() { return t('Make your first prediction: what will happen and how likely it is.') }, get description() { return t('Once you close five predictions, the calibration chart appears.') } },
  idea: { get title() { return t('No ideas yet.') }, get description() { return t('Sparks from your records gather here, then grow into tasks.') } },
  task: { get title() { return t('No tasks yet.') }, get description() { return t('Next steps from your records and your own.') } },
  question: { get title() { return t('No open questions.') }, get description() { return t('A question stays here until you find the answer.') } },
  lesson: { get title() { return t('No lessons yet.') }, get description() { return t('Conclusions you want to remember.') } },
  fact: { get title() { return t('No facts yet.') }, get description() { return t('Settled knowledge about you and your work: “I have 14 users”.') } },
};
