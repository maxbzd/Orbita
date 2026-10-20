import type { itemsRepo } from '../../db';
import { isDayKey, localDayKey, startOfDayInstant } from '../../domain/dates';
import { ITEM_TITLE_MAX, PREDICTION_PROBABILITY_MAX, PREDICTION_PROBABILITY_MIN } from '../../domain/schemas';
import type { CommitmentDirection, DayKey, ID, IdeaStage, Item, ItemKind, TaskPriority } from '../../domain/types';
import { t } from '../../i18n';

export type NewItem = itemsRepo.NewItem;
export type ItemPatch = itemsRepo.ItemPatch;

/**
 * The form state of an object, one flat shape for every kind: text fields stay strings while typing,
 * and `draftToNewItem` / `draftToPatch` turn them into a record.
 */
export interface ItemDraft {
  kind: ItemKind;
  title: string;
  body: string;
  /** `YYYY-MM-DD` or empty: deadline, review date or resolution date, depending on the kind. */
  dueDay: string;
  personIds: ID[];
  projectIds: ID[];
  // commitment
  direction: CommitmentDirection;
  counterpartyId: ID | '';
  counterpartyName: string;
  // decision (alternatives and reasons: one per line)
  question: string;
  chosen: string;
  alternatives: string;
  reasons: string;
  expected: string;
  // idea
  stage: IdeaStage;
  // prediction, percent 1..99
  probability: number;
  // task
  priority: TaskPriority | '';
  scheduledFor: string;
  // question
  answer: string;
  // fact
  value: string;
}

export function emptyDraft(kind: ItemKind, defaults: Partial<ItemDraft> = {}): ItemDraft {
  return {
    kind,
    title: '',
    body: '',
    dueDay: '',
    personIds: [],
    projectIds: [],
    direction: 'i_owe',
    counterpartyId: '',
    counterpartyName: '',
    question: '',
    chosen: '',
    alternatives: '',
    reasons: '',
    expected: '',
    stage: 'spark',
    probability: 50,
    priority: '',
    scheduledFor: '',
    answer: '',
    value: '',
    ...defaults,
  };
}

const lines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export function draftFromItem(item: Item): ItemDraft {
  const draft = emptyDraft(item.kind, {
    title: item.title,
    body: item.body ?? '',
    dueDay: item.dueAt ? localDayKey(item.dueAt) : '',
    personIds: [...item.personIds],
    projectIds: [...item.projectIds],
  });
  switch (item.kind) {
    case 'commitment':
      return { ...draft, direction: item.direction, counterpartyId: item.counterpartyId ?? '', counterpartyName: item.counterpartyName ?? '' };
    case 'decision':
      return {
        ...draft,
        question: item.question ?? '',
        chosen: item.chosen,
        alternatives: item.alternatives.join('\n'),
        reasons: item.reasons.join('\n'),
        expected: item.expected ?? '',
      };
    case 'idea':
      return { ...draft, stage: item.stage };
    case 'prediction':
      return { ...draft, probability: Math.round(item.probability * 100) };
    case 'task':
      return { ...draft, priority: item.priority ?? '', scheduledFor: item.scheduledFor ?? '' };
    case 'question':
      return { ...draft, answer: item.answer ?? '' };
    case 'fact':
      return { ...draft, value: item.value ?? '' };
    case 'lesson':
      return draft;
  }
}

/** A message for the first problem, or null when the draft can be saved. */
export function validateDraft(draft: ItemDraft): string | null {
  const title = draft.title.trim();
  if (title === '') return t('Describe it in a few words.');
  if (Array.from(title).length > ITEM_TITLE_MAX) return t('The title is longer than {ITEM_TITLE_MAX} characters: shorten it and put the details in the description.', { ITEM_TITLE_MAX });
  if (draft.dueDay !== '' && !isDayKey(draft.dueDay)) return t('The date is invalid.');
  if (draft.scheduledFor !== '' && !isDayKey(draft.scheduledFor)) return t('The date is invalid.');
  if (draft.kind === 'prediction' && !(draft.probability >= PREDICTION_PROBABILITY_MIN * 100 && draft.probability <= PREDICTION_PROBABILITY_MAX * 100)) {
    return t('Probability must be between 1 and 99 %.');
  }
  return null;
}

/** A deadline day becomes the start of that local day, so "today" counts as due all day. */
export const dayToDue = (day: DayKey): string => startOfDayInstant(day).toISOString();

function common(draft: ItemDraft) {
  const body = draft.body.trim();
  return {
    title: draft.title.trim(),
    body: body === '' ? undefined : body,
    personIds: draft.personIds,
    projectIds: draft.projectIds,
    dueAt: draft.dueDay === '' ? undefined : dayToDue(draft.dueDay),
  };
}

const orUndefined = (text: string): string | undefined => (text.trim() === '' ? undefined : text.trim());

/** Fields of the kind (without the common ones), as a patch. */
function kindFields(draft: ItemDraft, people: ReadonlyMap<ID, string>): Record<string, unknown> {
  switch (draft.kind) {
    case 'commitment': {
      const counterpartyId = draft.counterpartyId === '' ? undefined : draft.counterpartyId;
      const counterpartyName = counterpartyId ? (people.get(counterpartyId) ?? orUndefined(draft.counterpartyName)) : orUndefined(draft.counterpartyName);
      return { direction: draft.direction, counterpartyId, counterpartyName };
    }
    case 'decision':
      return {
        question: orUndefined(draft.question),
        chosen: orUndefined(draft.chosen) ?? draft.title.trim(),
        alternatives: lines(draft.alternatives),
        reasons: lines(draft.reasons),
        expected: orUndefined(draft.expected),
      };
    case 'idea':
      return { stage: draft.stage };
    case 'prediction':
      return { probability: draft.probability / 100 };
    case 'task':
      return { priority: draft.priority === '' ? undefined : draft.priority, scheduledFor: draft.scheduledFor === '' ? undefined : draft.scheduledFor };
    case 'question':
      return { answer: orUndefined(draft.answer) };
    case 'fact':
      return { value: orUndefined(draft.value) };
    case 'lesson':
      return {};
  }
}

/** `people` maps ids to names so a chosen counterparty also keeps its name. */
export function draftToNewItem(draft: ItemDraft, people: ReadonlyMap<ID, string> = new Map()): NewItem {
  return { kind: draft.kind, ...common(draft), ...kindFields(draft, people) } as NewItem;
}

export function draftToPatch(draft: ItemDraft, people: ReadonlyMap<ID, string> = new Map()): ItemPatch {
  return { ...common(draft), ...kindFields(draft, people) } as ItemPatch;
}

/** Percent shown next to the slider: "70 %". */
export const formatPercent = (value: number): string => `${Math.round(value)} %`;
