import { instrumentalName } from '../../i18n/ru-names';
import { formatDayShort, localDayKey } from '../../domain/dates';
import { itemKindCount, objectsCount } from '../../domain/counts';
import type { Capture, ID, Item, ItemKind, Person } from '../../domain/types';
import type { Job, WaitingReason } from '../../state';
import { t, msg } from '../../i18n';

/**
 * What the review screen shows, decided in one pure place from the capture, its objects and the processing job.
 * The order matters: a running job beats everything (a repeat run replaces the proposals), then failures and
 * waiting, then the objects themselves.
 */

export type ProcessingStage = 'saving' | 'queued' | 'transcribing' | 'extracting';

export type ReviewView =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'processing'; stage: ProcessingStage; manual: boolean }
  | { kind: 'failed'; message: string }
  /** Nothing is running and nothing is wrong: the capture waits for a key, a network, a text, or a tap. */
  | { kind: 'waiting'; reason: WaitingReason | 'idle'; message: string }
  | { kind: 'skipped' }
  | { kind: 'review'; proposed: Item[] }
  /** Everything is decided (or nothing was found). `accepted` are the objects now in memory. */
  | { kind: 'done'; accepted: Item[]; dismissed: number };

export interface ReviewInput {
  /** `undefined` while loading, `null` when there is no such capture. */
  capture: Capture | null | undefined;
  /** Every object of the capture, any status; `undefined` while loading. */
  items: readonly Item[] | undefined;
  job: Job | undefined;
}

const IDLE_MESSAGE = msg('The record is saved and waits for processing.');

export function deriveReviewView({ capture, items, job }: ReviewInput): ReviewView {
  if (capture === undefined || items === undefined) return { kind: 'loading' };
  if (capture === null || capture.deletedAt) return { kind: 'missing' };

  if (job?.stage === 'saving') return { kind: 'processing', stage: 'saving', manual: false };
  if (job?.stage === 'running' || capture.status === 'transcribing' || capture.status === 'extracting') {
    const stage: ProcessingStage =
      capture.status === 'transcribing' ? 'transcribing' : capture.status === 'extracting' ? 'extracting' : 'queued';
    return { kind: 'processing', stage, manual: job?.mode === 'manual' };
  }

  if (job?.stage === 'failed') return { kind: 'failed', message: job.message ?? capture.error ?? t('Could not process the recording') };
  if (capture.status === 'failed') return { kind: 'failed', message: capture.error ?? t('Could not process the recording') };
  if (job?.stage === 'waiting') {
    return { kind: 'waiting', reason: job.waiting ?? 'idle', message: job.message ?? t(IDLE_MESSAGE) };
  }

  const proposed = items.filter((item) => item.status === 'proposed');
  if (proposed.length > 0) return { kind: 'review', proposed };
  if (capture.status === 'skipped') return { kind: 'skipped' };
  if (capture.status === 'raw' || capture.status === 'transcribed') {
    // Saved, and no job in this session: it was never processed here (an import, a restored recording, a reload).
    return { kind: 'waiting', reason: 'idle', message: t(IDLE_MESSAGE) };
  }

  const settled = items.filter((item) => item.status !== 'proposed');
  return {
    kind: 'done',
    accepted: settled.filter((item) => item.status !== 'dismissed'),
    dismissed: settled.filter((item) => item.status === 'dismissed').length,
  };
}

// ───────── Wording ─────────

export const KIND_ORDER: readonly ItemKind[] = ['decision', 'commitment', 'prediction', 'task', 'idea', 'question', 'lesson', 'fact'];

/** «Нашёл 5 объектов», «Нашёл 1 объект». */
export const foundTitle = (count: number): string => t('Found {objectsCount}', { objectsCount: objectsCount(count) });

export function groupByKind(items: readonly Item[]): Array<{ kind: ItemKind; items: Item[] }> {
  return KIND_ORDER.map((kind) => ({ kind, items: items.filter((item) => item.kind === kind) })).filter((group) => group.items.length > 0);
}

/** «2 решения», «1 обязательство»: the log line of a finished run. */
export function countLine(kind: ItemKind, count: number): string {
  return itemKindCount(kind, count);
}

/** The honest log of a finished run: only what was really found. */
export function foundLog(items: readonly Item[]): string[] {
  return groupByKind(items).map((group) => t('Found {countLine}', { countLine: countLine(group.kind, group.items.length) }));
}

const shortDate = (iso: string): string => formatDayShort(localDayKey(iso));

const nameOf = (id: ID | undefined, fallback: string | undefined, people: ReadonlyMap<ID, Person>): string | undefined =>
  (id ? people.get(id)?.name : undefined) ?? fallback;

/**
 * The second line of a row and a card: whom it concerns and when (§3.5 "кому/срок"). Short pieces, joined with " · "
 * by the caller; empty when the object has nothing but its wording.
 */
export function itemFacts(item: Item, people: ReadonlyMap<ID, Person> = new Map()): string[] {
  const facts: string[] = [];
  switch (item.kind) {
    case 'commitment': {
      const who = nameOf(item.counterpartyId, item.counterpartyName, people);
      if (who) facts.push(item.direction === 'i_owe' ? t('To: {who}', { who }) : t('From: {who}', { who }));
      else facts.push(item.direction === 'i_owe' ? t('I owe') : t('Owed to me'));
      if (item.dueAt) facts.push(t('by {shortDate}', { shortDate: shortDate(item.dueAt) }));
      break;
    }
    case 'decision':
      if (item.chosen) facts.push(t('Chose: {chosen}', { chosen: item.chosen }));
      if (item.dueAt) facts.push(t('review {shortDate}', { shortDate: shortDate(item.dueAt) }));
      break;
    case 'prediction':
      facts.push(`${Math.round(item.probability * 100)} %`);
      if (item.dueAt) facts.push(t('by {shortDate}', { shortDate: shortDate(item.dueAt) }, 'prediction'));
      break;
    case 'task':
      if (item.dueAt) facts.push(t('by {shortDate}', { shortDate: shortDate(item.dueAt) }));
      else if (item.scheduledFor) facts.push(t('on {formatDayShort}', { formatDayShort: formatDayShort(item.scheduledFor) }));
      if (item.priority === 'high') facts.push(t('important'));
      break;
    case 'fact':
      if (item.value) facts.push(item.value);
      break;
    default:
      if (item.dueAt) facts.push(shortDate(item.dueAt));
  }
  const others = item.personIds.map((id) => people.get(id)?.name).filter((name): name is string => Boolean(name));
  if (item.kind !== 'commitment') for (const name of others.slice(0, 2)) facts.push(name);
  return facts;
}

/** «Добавлено в память: обязательство перед Фёдором» (§3.5 point 4). */
export function memoryPhrase(item: Item, people: ReadonlyMap<ID, Person> = new Map(), max = 56): string {
  const cut = (text: string): string => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
  switch (item.kind) {
    case 'commitment': {
      const who = nameOf(item.counterpartyId, item.counterpartyName, people);
      if (who) return item.direction === 'i_owe' ? t('commitment to {instrumentalName}', { instrumentalName: instrumentalName(who) }) : t('commitment to you: {who}', { who });
      return cut(t('commitment: {title}', { title: item.title }));
    }
    case 'decision':
      return cut(t('decision: {title}', { title: item.title }));
    case 'prediction':
      return cut(t('prediction: {title}', { title: item.title }));
    case 'idea':
      return cut(t('idea: {title}', { title: item.title }));
    case 'task':
      return cut(t('task: {title}', { title: item.title }));
    case 'question':
      return cut(t('question: {title}', { title: item.title }));
    case 'lesson':
      return cut(t('lesson: {title}', { title: item.title }));
    case 'fact':
      return cut(t('fact: {title}', { title: item.title }));
  }
}

/** Position of a quote in the recording, as a rough time (the text has offsets, not time stamps). */
export function approximateSecond(capture: Pick<Capture, 'text' | 'durationSec'>, quoteStart: number | undefined): number | undefined {
  if (quoteStart === undefined || !capture.durationSec || capture.text.length === 0) return undefined;
  const share = Math.min(1, Math.max(0, quoteStart / capture.text.length));
  return Math.round(share * capture.durationSec);
}

export { instrumentalName };
