import { addDays, isDayKey, startOfDayInstant } from '../domain/dates';
import { ITEM_TITLE_MAX } from '../domain/schemas';
import { truncate } from '../domain/text';
import type { DayKey, ID, ISODate, ItemKind } from '../domain/types';
import type { itemsRepo } from '../db';
import type { ExtractedItem } from './prompts/schemas';
import { locateQuote } from './quotes';

/**
 * Turns what the model said into item drafts the repositories accept: clamped numbers, resolved dates,
 * quotes checked against the record, people and projects replaced by ids. A draft is dropped when
 * there is nothing sound to keep (no title, hopeless confidence).
 */

/** Below this the model is guessing; the object is not even proposed. */
export const MIN_ITEM_CONFIDENCE = 0.3;
/** Confidence factor for an object whose evidence quote could not be found in the record. */
const UNVERIFIED_QUOTE_FACTOR = 0.8;
const DEFAULT_CONFIDENCE = 0.6;
const MAX_DUE_YEARS = 5;
const MAX_TAGS = 4;
const MAX_LIST_ITEMS = 10;
const MAX_LIST_ITEM_CHARS = 200;

export type ItemDraft = itemsRepo.NewItem;

export interface DraftContext {
  /** The record text, for locating quotes. */
  text: string;
  captureDay: DayKey;
  personId(name: string): ID | undefined;
  projectId(name: string): ID | undefined;
  /** Short code (o1…) → the open object it stands for, to honor the model's `duplicateOf`. */
  openItemByRef: ReadonlyMap<string, { id: ID; kind: ItemKind }>;
}

// ───────── Numbers and dates ─────────

/** 0..1, tolerating percentages ("85") and junk. */
export function normalizeUnit(value: number | null | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const unit = value > 1 && value <= 100 ? value / 100 : value;
  return Math.min(1, Math.max(0, unit));
}

/** 0.01..0.99 for predictions; "70" means 70 %. */
export function normalizeProbability(value: number): number {
  return Math.min(0.99, Math.max(0.01, normalizeUnit(value, 0.5)));
}

/**
 * `dueAt` for a calendar day the model named: the last minute of that local day, so that something due
 * "on Friday" is not overdue on Friday morning. Days before the record or absurdly far away are dropped.
 */
export function dueAtFromDay(day: string | null | undefined, captureDay: DayKey): ISODate | undefined {
  const trimmed = day?.trim();
  if (!trimmed || !isDayKey(trimmed) || trimmed < captureDay || trimmed > addDays(captureDay, 366 * MAX_DUE_YEARS)) return undefined;
  return new Date(startOfDayInstant(addDays(trimmed, 1)).getTime() - 60_000).toISOString();
}

// ───────── Text ─────────

const clean = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();

function cleanList(values: readonly string[]): string[] {
  return values
    .map(clean)
    .filter((value) => value !== '')
    .slice(0, MAX_LIST_ITEMS)
    .map((value) => truncate(value, MAX_LIST_ITEM_CHARS));
}

export function normalizeTags(tags: readonly string[], limit = MAX_TAGS): string[] {
  const normalized = tags.map((tag) => tag.trim().toLowerCase().replace(/^#/, '')).filter((tag) => tag !== '' && tag.length <= 30);
  return [...new Set(normalized)].slice(0, limit);
}

/** Drops `undefined` values so stored records stay free of placeholders. The constraint keeps `kind` a literal. */
function compact<D extends ItemDraft>(value: D): ItemDraft {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as ItemDraft;
}

const unique = <T>(values: readonly (T | undefined)[]): T[] => [...new Set(values.filter((value): value is T => value !== undefined))];

// ───────── Drafts ─────────

/** Kinds for which a deadline or review date means something. */
const DATED_KINDS: ReadonlySet<ItemKind> = new Set(['decision', 'commitment', 'prediction', 'task']);

export function toItemDraft(item: ExtractedItem, context: DraftContext): ItemDraft | undefined {
  const title = truncate(clean(item.title), ITEM_TITLE_MAX);
  if (title === '') return undefined;

  const stated = normalizeUnit(item.confidence, DEFAULT_CONFIDENCE);
  const located = locateQuote(context.text, item.quote);
  // A quote the model gave but the record does not contain is a warning sign; no quote at all is just absence.
  const confidence = item.quote && !located ? stated * UNVERIFIED_QUOTE_FACTOR : stated;
  if (confidence < MIN_ITEM_CONFIDENCE) return undefined;

  const counterparty = item.kind === 'commitment' ? clean(item.counterparty) : '';
  const counterpartyId = counterparty === '' ? undefined : context.personId(counterparty);

  const duplicate = item.duplicateOf ? context.openItemByRef.get(item.duplicateOf.trim().toLowerCase()) : undefined;
  const base = {
    title,
    body: clean(item.body) || undefined,
    quote: located?.quote,
    quoteStart: located?.start,
    personIds: unique([...item.people.map((name) => context.personId(clean(name))), counterpartyId]),
    projectIds: unique(item.projects.map((name) => context.projectId(clean(name)))),
    tags: normalizeTags(item.tags),
    confidence,
    duplicateOf: duplicate && duplicate.kind === item.kind ? duplicate.id : undefined,
    dueAt: DATED_KINDS.has(item.kind) ? dueAtFromDay(item.dueDate, context.captureDay) : undefined,
  };

  switch (item.kind) {
    case 'decision':
      return compact({
        ...base,
        kind: 'decision',
        question: clean(item.question) || undefined,
        chosen: clean(item.chosen) || title,
        alternatives: cleanList(item.alternatives),
        reasons: cleanList(item.reasons),
        expected: clean(item.expected) || undefined,
      });
    case 'commitment':
      return compact({
        ...base,
        kind: 'commitment',
        direction: item.direction,
        counterpartyId,
        counterpartyName: counterparty !== '' && counterpartyId === undefined ? counterparty : undefined,
      });
    case 'idea':
      return compact({ ...base, kind: 'idea', stage: item.stage, relatedIds: [] });
    case 'prediction':
      return compact({ ...base, kind: 'prediction', probability: normalizeProbability(item.probability) });
    case 'task':
      return compact({ ...base, kind: 'task', priority: item.priority ?? undefined });
    case 'question':
      return compact({ ...base, kind: 'question' });
    case 'lesson':
      return compact({ ...base, kind: 'lesson' });
    case 'fact':
      return compact({ ...base, kind: 'fact', value: clean(item.value) || undefined });
  }
}
