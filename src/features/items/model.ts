import { calibrationReport } from '../../domain/calibration';
import type { CalibrationReport } from '../../domain/calibration';
import { t, tn } from '../../i18n';
import { diffDays, formatDayShort, localDayKey, relativeDay } from '../../domain/dates';
import { normalizeForSearch } from '../../domain/text';
import type {
  CommitmentDirection,
  DayKey,
  ID,
  IdeaStage,
  ISODate,
  Item,
  ItemKind,
  ItemOfKind,
  ItemStatus,
  Person,
} from '../../domain/types';
import { ITEM_KINDS } from '../../domain/types';

/** Open commitments due within this many days (or already late) are "Скоро". */
export const SOON_DAYS = 7;

/** The order the kinds are listed in: collections, the «+» sheet. */
export const KIND_ORDER: readonly ItemKind[] = ['commitment', 'decision', 'prediction', 'idea', 'task', 'question', 'lesson', 'fact'];

export const isItemKind = (value: string | undefined): value is ItemKind => ITEM_KINDS.includes(value as ItemKind);

// ───────── Status and search filter ─────────

export const STATUS_FILTERS = ['all', 'open', 'closed', 'proposed'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  get all() { return t('All') },
  get open() { return t('Open', undefined, 'model') },
  get closed() { return t('Closed') },
  get proposed() { return t('Awaiting confirmation') },
};

export interface ItemQuery {
  text: string;
  status: StatusFilter;
  personId?: ID;
  projectId?: ID;
}

export const EMPTY_QUERY: ItemQuery = { text: '', status: 'all' };

/** Everything a search can find in an object, normalized once. */
export function itemSearchText(item: Item): string {
  const parts: Array<string | undefined> = [item.title, item.body, item.quote, ...item.tags];
  switch (item.kind) {
    case 'commitment':
      parts.push(item.counterpartyName);
      break;
    case 'decision':
      parts.push(item.question, item.chosen, item.expected, ...item.alternatives, ...item.reasons, item.outcome?.note);
      break;
    case 'prediction':
      parts.push(item.resolutionNote);
      break;
    case 'question':
      parts.push(item.answer);
      break;
    case 'fact':
      parts.push(item.value);
      break;
    default:
      break;
  }
  return normalizeForSearch(parts.filter(Boolean).join(' '));
}

const CLOSED: readonly ItemStatus[] = ['done', 'dropped'];

/** Which statuses the filter lets through. Dismissed proposals are never listed. */
export function statusMatches(status: ItemStatus, filter: StatusFilter): boolean {
  if (status === 'dismissed') return false;
  switch (filter) {
    case 'all':
      return status !== 'proposed';
    case 'open':
      return status === 'active';
    case 'closed':
      return CLOSED.includes(status);
    case 'proposed':
      return status === 'proposed';
  }
}

/** Search (every word must occur), status, person and project. Order is kept. */
export function filterItems(items: readonly Item[], query: ItemQuery): Item[] {
  const needles = normalizeForSearch(query.text).split(' ').filter(Boolean);
  return items.filter((item) => {
    if (!statusMatches(item.status, query.status)) return false;
    if (query.personId && !itemPeople(item).includes(query.personId)) return false;
    if (query.projectId && !item.projectIds.includes(query.projectId)) return false;
    if (needles.length === 0) return true;
    const haystack = itemSearchText(item);
    return needles.every((needle) => haystack.includes(needle));
  });
}

/** People attached to an object, the counterparty of a commitment included. */
export function itemPeople(item: Item): ID[] {
  if (item.kind === 'commitment' && item.counterpartyId && !item.personIds.includes(item.counterpartyId)) {
    return [...item.personIds, item.counterpartyId];
  }
  return item.personIds;
}

/** How many objects of each status the filter chips could show (for the counters). */
export function countByStatusFilter(items: readonly Item[]): Record<StatusFilter, number> {
  const counts = { all: 0, open: 0, closed: 0, proposed: 0 } satisfies Record<StatusFilter, number>;
  for (const filter of STATUS_FILTERS) counts[filter] = items.filter((item) => statusMatches(item.status, filter)).length;
  return counts;
}

// ───────── Deadlines ─────────

export interface DueInfo {
  /** Whole days from today to the deadline: negative when late. */
  days: number;
  overdue: boolean;
  /** Plain words, never colour alone: «просрочено на 3 дня», «сегодня», «через 4 дня». */
  label: string;
}

export const dueDay = (item: Item): DayKey | undefined => (item.dueAt ? localDayKey(item.dueAt) : undefined);

/** Deadline of an object relative to `today`; undefined without a deadline. */
export function dueInfo(item: Item, today: DayKey): DueInfo | undefined {
  const day = dueDay(item);
  if (!day) return undefined;
  const days = diffDays(today, day);
  if (days < 0) {
    const late = -days;
    return { days, overdue: true, label: tn(late, 'overdue by {n} day', 'overdue by {n} days') };
  }
  return { days, overdue: false, label: relativeDay(day, today) };
}

const isOpen = (item: Item): boolean => item.status === 'active';

/** Open and late: shown with a danger tone and always with the words. */
export function isOverdue(item: Item, today: DayKey): boolean {
  return isOpen(item) && (dueInfo(item, today)?.overdue ?? false);
}

/** The deadline line of a row: «просрочено на 2 дня», «срок через 4 дня», «пора пересмотреть». */
export function dueText(item: Item, today: DayKey): string | undefined {
  if (!isOpen(item)) return undefined;
  if ((item.kind === 'decision' || item.kind === 'prediction') && item.outcome) return undefined;
  const info = dueInfo(item, today);
  if (!info) return undefined;
  switch (item.kind) {
    case 'decision':
      return info.days <= 0 ? t('time to review') : t('review {label}', { label: info.label });
    case 'prediction':
      return info.days <= 0 ? t('time to close') : t('outcome {label}', { label: info.label });
    default:
      return info.overdue ? info.label : info.days === 0 ? t('due today') : t('due {label}', { label: info.label });
  }
}

// ───────── Sorting ─────────

const byNewest = (a: Item, b: Item): number => b.createdAt.localeCompare(a.createdAt);
const byDue = (a: Item, b: Item): number => (a.dueAt ?? '￿').localeCompare(b.dueAt ?? '￿') || byNewest(a, b);
const byClosedAt = (a: Item, b: Item): number => (b.doneAt ?? b.updatedAt).localeCompare(a.doneAt ?? a.updatedAt);

// ───────── Groups ─────────

export interface ItemGroup {
  id: string;
  /** Empty for a list that needs no heading. */
  title: string;
  items: Item[];
}

const group = (id: string, title: string, items: Item[]): ItemGroup => ({ id, title, items });
const nonEmpty = (groups: ItemGroup[]): ItemGroup[] => groups.filter((g) => g.items.length > 0);

export interface GroupContext {
  today: DayKey;
}

/** Commitments: «Скоро» (late and due within a week), «Активные», «Закрытые». */
export function groupCommitments(items: readonly Item[], { today }: GroupContext): ItemGroup[] {
  const open = items.filter(isOpen).sort(byDue);
  const soon = open.filter((item) => {
    const info = dueInfo(item, today);
    return info !== undefined && info.days <= SOON_DAYS;
  });
  const rest = open.filter((item) => !soon.includes(item));
  return nonEmpty([
    group('soon', t('Soon'), soon),
    group('active', t('Active'), rest),
    group('closed', t('Closed'), items.filter((item) => CLOSED.includes(item.status)).sort(byClosedAt)),
  ]);
}

const personKey = (item: ItemOfKind<'commitment'>): string =>
  item.counterpartyId ?? (item.counterpartyName ? `name:${normalizeForSearch(item.counterpartyName)}` : 'none');

/** Open commitments grouped by who they are with; the person with the most urgent one first. Closed ones go last. */
export function groupCommitmentsByPerson(
  items: readonly Item[],
  people: ReadonlyMap<ID, Pick<Person, 'name'>>,
  { today }: GroupContext,
): ItemGroup[] {
  const commitments = items.filter((item): item is ItemOfKind<'commitment'> => item.kind === 'commitment');
  const buckets = new Map<string, { title: string; items: ItemOfKind<'commitment'>[] }>();
  for (const item of commitments.filter(isOpen).sort(byDue)) {
    const key = personKey(item);
    const title = item.counterpartyId
      ? (people.get(item.counterpartyId)?.name ?? item.counterpartyName ?? t('No name'))
      : (item.counterpartyName ?? t('No person'));
    const bucket = buckets.get(key) ?? { title, items: [] };
    bucket.items.push(item);
    buckets.set(key, bucket);
  }
  const groups = [...buckets.entries()].map(([key, bucket]) => group(`person:${key}`, bucket.title, bucket.items));
  groups.sort((a, b) => {
    const lateA = a.items.some((item) => isOverdue(item, today)) ? 0 : 1;
    const lateB = b.items.some((item) => isOverdue(item, today)) ? 0 : 1;
    return lateA - lateB || b.items.length - a.items.length || a.title.localeCompare(b.title, 'ru');
  });
  return nonEmpty([...groups, group('closed', t('Closed'), commitments.filter((item) => CLOSED.includes(item.status)).sort(byClosedAt))]);
}

/** Direction filter of the commitment toggle. */
export type DirectionFilter = 'all' | CommitmentDirection;

export function filterDirection(items: readonly Item[], direction: DirectionFilter): Item[] {
  return direction === 'all' ? [...items] : items.filter((item) => item.kind === 'commitment' && item.direction === direction);
}

/** Decisions: «Пора пересмотреть», «Журнал» (open, newest first), «Пересмотрено». */
export function groupDecisions(items: readonly Item[], { today }: GroupContext): ItemGroup[] {
  const open = items.filter((item) => isOpen(item) && !(item.kind === 'decision' && item.outcome));
  const due = open.filter((item) => {
    const info = dueInfo(item, today);
    return info !== undefined && info.days <= 0;
  });
  const rest = open.filter((item) => !due.includes(item));
  return nonEmpty([
    group('due', t('Time to review'), due.sort(byDue)),
    group('journal', t('Journal'), rest.sort(byNewest)),
    group('reviewed', t('Reviewed'), items.filter((item) => !open.includes(item)).sort(byClosedAt)),
  ]);
}

/** Predictions: «К закрытию» (the date has come), «Открытые», «Закрытые». */
export function groupPredictions(items: readonly Item[], { today }: GroupContext): ItemGroup[] {
  const open = items.filter((item) => isOpen(item) && !(item.kind === 'prediction' && item.outcome));
  const due = open.filter((item) => {
    const info = dueInfo(item, today);
    return info !== undefined && info.days <= 0;
  });
  const rest = open.filter((item) => !due.includes(item));
  return nonEmpty([
    group('due', t('To close'), due.sort(byDue)),
    group('open', t('Open', undefined, 'model'), rest.sort(byDue)),
    group('closed', t('Closed'), items.filter((item) => !open.includes(item)).sort(byClosedAt)),
  ]);
}

export const STAGE_LABELS: Record<IdeaStage, string> = {
  get spark() { return t('Spark') },
  get exploring() { return t('Exploring') },
  get doing() { return t('In progress') },
  get parked() { return t('Parked') },
  get dropped() { return t('Discarded') },
};

const STAGE_GROUP_TITLES: Record<IdeaStage, string> = {
  get spark() { return t('Sparks') },
  get exploring() { return t('Exploring') },
  get doing() { return t('In progress') },
  get parked() { return t('Parked', undefined, 'group') },
  get dropped() { return t('Discarded', undefined, 'group') },
};

/** Ideas by stage: spark → exploring → doing → parked → dropped; finished ideas sit before the dropped ones. */
export function groupIdeas(items: readonly Item[]): ItemGroup[] {
  const ideas = items.filter((item): item is ItemOfKind<'idea'> => item.kind === 'idea');
  const done = ideas.filter((item) => item.status === 'done');
  const live = ideas.filter((item) => item.status !== 'done');
  const at = (stage: IdeaStage): ItemGroup =>
    group(stage, STAGE_GROUP_TITLES[stage], live.filter((item) => item.stage === stage).sort(byNewest));
  return nonEmpty([at('spark'), at('exploring'), at('doing'), at('parked'), group('done', t('Done', undefined, 'model'), done.sort(byClosedAt)), at('dropped')]);
}

/** What the stage means for the status: a dropped idea is closed, any other stage keeps it open. */
export function stageChange(stage: IdeaStage, status: ItemStatus): { stage: IdeaStage; status: ItemStatus } {
  if (stage === 'dropped') return { stage, status: 'dropped' };
  return { stage, status: status === 'dropped' || status === 'done' ? 'active' : status };
}

/** Tasks: «Открытые» (soonest deadline first) and «Готово». */
export function groupTasks(items: readonly Item[]): ItemGroup[] {
  return nonEmpty([
    group('open', t('Open', undefined, 'model'), items.filter(isOpen).sort(byDue)),
    group('closed', t('Done'), items.filter((item) => CLOSED.includes(item.status)).sort(byClosedAt)),
  ]);
}

/** Questions: «Открытые» and «С ответом». */
export function groupQuestions(items: readonly Item[]): ItemGroup[] {
  const unanswered = items.filter((item) => isOpen(item) && !(item.kind === 'question' && item.answer?.trim()));
  return nonEmpty([
    group('open', t('Open', undefined, 'model'), unanswered.sort(byNewest)),
    group('answered', t('Answered'), items.filter((item) => !unanswered.includes(item)).sort(byClosedAt)),
  ]);
}

/** Facts: the current ones, then those a newer fact replaced. */
export function groupFacts(items: readonly Item[]): ItemGroup[] {
  const outdated = (item: Item): boolean => item.kind === 'fact' && (item.supersededBy !== undefined || item.status === 'dropped');
  return nonEmpty([
    group('current', t('Current'), items.filter((item) => !outdated(item)).sort(byNewest)),
    group('outdated', t('Outdated'), items.filter(outdated).sort(byNewest)),
  ]);
}

/** One group per kind's logic; `proposed` (the "ждут подтверждения" filter) is a flat list. */
export function groupItems(kind: ItemKind, items: readonly Item[], context: GroupContext): ItemGroup[] {
  const proposed = items.filter((item) => item.status === 'proposed');
  const others = items.filter((item) => item.status !== 'proposed');
  const lead = nonEmpty([group('proposed', t('Awaiting confirmation'), proposed.sort(byNewest))]);
  switch (kind) {
    case 'commitment':
      return [...lead, ...groupCommitments(others, context)];
    case 'decision':
      return [...lead, ...groupDecisions(others, context)];
    case 'prediction':
      return [...lead, ...groupPredictions(others, context)];
    case 'idea':
      return [...lead, ...groupIdeas(others)];
    case 'task':
      return [...lead, ...groupTasks(others)];
    case 'question':
      return [...lead, ...groupQuestions(others)];
    case 'fact':
      return [...lead, ...groupFacts(others)];
    case 'lesson':
      return [...lead, ...nonEmpty([group('all', '', [...others].sort(byNewest))])];
  }
}

// ───────── Decisions: the review window ─────────

export interface ReviewWindow {
  /** 0..1 share of the time between the decision and its review date that has passed. */
  progress: number;
  daysLeft: number;
  due: boolean;
  /** «до пересмотра 12 дней», «пересмотр сегодня», «пересмотр просрочен на 3 дня». */
  label: string;
}

/** The ring "до пересмотра N дней"; undefined without a review date or when the decision is already reviewed. */
export function reviewWindow(item: ItemOfKind<'decision'>, now: ISODate, today: DayKey): ReviewWindow | undefined {
  if (!item.dueAt || item.outcome) return undefined;
  const total = Date.parse(item.dueAt) - Date.parse(item.createdAt);
  const elapsed = Date.parse(now) - Date.parse(item.createdAt);
  const progress = total > 0 ? Math.min(1, Math.max(0, elapsed / total)) : 1;
  const daysLeft = diffDays(today, localDayKey(item.dueAt));
  const late = -daysLeft;
  const label =
    daysLeft > 0
      ? tn(daysLeft, '{n} day until review', '{n} days until review')
      : daysLeft === 0
        ? t('review today')
        : tn(late, 'review overdue by {n} day', 'review overdue by {n} days');
  return { progress, daysLeft, due: daysLeft <= 0, label };
}

export const RATING_LABELS: Record<number, string> = {
  get 1() { return t('Went badly') },
  get 2() { return t('More bad than good') },
  get 3() { return t('So-so') },
  get 4() { return t('Good') },
  get 5() { return t('Great') },
};

// ───────── Predictions: calibration ─────────

const comma = (value: number, digits = 2): string => value.toFixed(digits).replace('.', ',');

export interface CalibrationSummary {
  enough: boolean;
  headline: string;
  /** Plain-words lines under the headline. */
  lines: string[];
  brier?: string;
}

/** The words next to the chart: Brier score and the direction of the bias; «мало данных» under five closed. */
export function summarizeCalibration(report: CalibrationReport): CalibrationSummary {
  if (!report.enough) {
    return {
      enough: false,
      headline: t('Not enough data'),
      lines: [
        t('{closed} of {needed} closed. The chart appears once {needed2} predictions are closed.', { closed: report.closed, needed: report.needed, needed2: report.needed }),
        t('“Unknown” does not count: there is nothing to check against.'),
      ],
    };
  }
  const bias = Math.round(report.bias * 100);
  const lines = [
    tn(report.closed, '{n} prediction closed: on average you said {mean} %, {hit} % came true.', '{n} predictions closed: on average you said {mean} %, {hit} % came true.', { mean: Math.round(report.meanProbability * 100), hit: Math.round(report.hitRate * 100) }),
    t('Brier score: 0 is perfect, 0.25 is what you get by always saying 50 %.'),
  ];
  if (Math.abs(bias) >= 5) {
    lines.splice(1, 0, bias > 0 ? t('You tend to overrate “yes” by {bias} pp.', { bias }) : t('You tend to underrate “yes” by {v} pp.', { v: -bias }));
  } else {
    lines.splice(1, 0, t('No skew: your confidence is close to what came true.'));
  }
  return { enough: true, headline: t('Brier score {comma}', { comma: comma(report.brier) }), lines, brier: comma(report.brier) };
}

export function predictionReport(items: readonly Item[]): CalibrationReport {
  return calibrationReport(items.filter((item): item is ItemOfKind<'prediction'> => item.kind === 'prediction'));
}

// ───────── Row text ─────────

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  get proposed() { return t('Waiting for confirmation') },
  get active() { return t('Open') },
  get done() { return t('Done') },
  get dropped() { return t('Not relevant') },
  get dismissed() { return t('Dismissed') },
};

const PRIORITY_LABELS = { get low() { return t('low priority') }, get normal() { return t('normal priority') }, get high() { return t('high priority') } } as const;

/** The quiet second line of a row: what is particular to the kind. */
export function rowSubtitle(item: Item, people: ReadonlyMap<ID, Pick<Person, 'name'>>): string | undefined {
  const parts: string[] = [];
  switch (item.kind) {
    case 'commitment': {
      const who = (item.counterpartyId && people.get(item.counterpartyId)?.name) || item.counterpartyName;
      parts.push(item.direction === 'i_owe' ? (who ? t('I owe: {who}', { who }) : t('I owe')) : who ? t('Owed to me: {who}', { who }) : t('Owed to me'));
      break;
    }
    case 'decision':
      if (item.outcome) parts.push(t('Outcome: {rating} of 5{v}', { rating: item.outcome.rating, v: item.outcome.note ? ` · ${item.outcome.note}` : '' }));
      else if (item.chosen && item.chosen !== item.title) parts.push(t('Chosen: {chosen}', { chosen: item.chosen }));
      break;
    case 'prediction':
      parts.push(`${Math.round(item.probability * 100)} %`);
      if (item.outcome === 'true') parts.push(t('came true'));
      else if (item.outcome === 'false') parts.push(t('did not come true'));
      else if (item.outcome === 'unknown') parts.push(t('outcome unknown'));
      break;
    case 'idea':
      parts.push(STAGE_LABELS[item.stage]);
      if (item.duplicateOf) parts.push(t('possible duplicate'));
      break;
    case 'task':
      if (item.priority === 'high') parts.push(PRIORITY_LABELS.high);
      if (item.scheduledFor) parts.push(t('on {formatDayShort}', { formatDayShort: formatDayShort(item.scheduledFor) }));
      break;
    case 'question':
      if (item.answer?.trim()) parts.push(t('Answer: {v}', { v: item.answer.trim() }));
      break;
    case 'fact':
      if (item.value) parts.push(item.value);
      if (item.supersededBy) parts.push(t('replaced by a newer one'));
      break;
    default:
      break;
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}
