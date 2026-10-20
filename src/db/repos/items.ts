import { nowISO } from '../../domain/dates';
import { newId } from '../../domain/ids';
import { ITEM_TITLE_MAX, PREDICTION_PROBABILITY_MAX, PREDICTION_PROBABILITY_MIN } from '../../domain/schemas';
import { truncate } from '../../domain/text';
import type {
  CommitmentDirection,
  DecisionOutcome,
  DecisionRating,
  ID,
  ISODate,
  Item,
  ItemKind,
  ItemOfKind,
  ItemStatus,
  PredictionOutcome,
} from '../../domain/types';
import {
  NotFoundError,
  byCreatedDesc,
  clamp,
  isLive,
  notDeleted,
  patchRecord,
  restoreRecord,
  softDeleteRecord,
} from '../internal';
import { db } from '../schema';
import * as links from './links';
import { t } from '../../i18n';

type Managed = 'updatedAt' | 'deletedAt';
/** Fields the repository fills in when the caller leaves them out. */
type Defaulted =
  | 'id'
  | 'createdAt'
  | 'isDemo'
  | 'status'
  | 'personIds'
  | 'projectIds'
  | 'tags'
  | 'alternatives'
  | 'reasons'
  | 'relatedIds'
  | 'stage';

type NewOf<T extends Item> = T extends Item
  ? Omit<T, Defaulted | Managed> & Partial<Pick<T, Extract<Defaulted, keyof T>>>
  : never;
type PatchOf<T extends Item> = T extends Item
  ? Partial<Omit<T, 'id' | 'kind' | 'createdAt' | Managed>>
  : never;

/** What `create` takes: the kind and its required fields; ids, timestamps, lists and status are defaulted. */
export type NewItem = NewOf<Item>;
/** What `update` takes: any fields of the item's kind except identity and timestamps. */
export type ItemPatch = PatchOf<Item>;

export interface ItemFilter {
  kind?: ItemKind | readonly ItemKind[];
  status?: ItemStatus | readonly ItemStatus[];
  personId?: ID;
  projectId?: ID;
  captureId?: ID;
  tag?: string;
}

const asList = <T>(value: T | readonly T[] | undefined): readonly T[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? (value as readonly T[]) : [value as T];

/** `reviewAt` (decision) and `resolvesAt` (prediction) are the same date as `dueAt`; the index is on `dueAt`. */
const DUE_ALIAS = { decision: 'reviewAt', prediction: 'resolvesAt' } as const;

/**
 * Invariants and bookkeeping applied to every write: non-empty title within the limit (invariant:
 * ≤ 120 characters), confidence in 0..1, `doneAt` follows the `done` status, prediction probability
 * in [0.01, 0.99] and `outcome` sets `resolvedAt` (invariant 5).
 */
function normalizeItem(item: Item, previous?: Item): Item {
  const title = item.title.trim();
  if (title === '') throw new RangeError(t("An object's title cannot be empty"));
  const next: Item = { ...item, title: truncate(title, ITEM_TITLE_MAX) };

  if (next.confidence !== undefined) next.confidence = clamp(next.confidence, 0, 1);
  if (next.status === 'done') next.doneAt ??= nowISO();
  else if (previous?.status === 'done') delete next.doneAt;

  if (next.kind === 'prediction') {
    if (Number.isNaN(next.probability)) throw new RangeError(t("A prediction's probability must be a number"));
    next.probability = clamp(next.probability, PREDICTION_PROBABILITY_MIN, PREDICTION_PROBABILITY_MAX);
    if (next.outcome === undefined) delete next.resolvedAt;
    else next.resolvedAt ??= nowISO();
  }
  return next;
}

/** Keeps a kind's date alias and `dueAt` in step: whichever the caller set wins, `dueAt` first. */
function syncDue<T extends { dueAt?: ISODate }>(kind: ItemKind, values: T): T {
  const alias = DUE_ALIAS[kind as keyof typeof DUE_ALIAS];
  if (!alias) return values;
  const record = values as Record<string, ISODate | undefined>;
  if ('dueAt' in values) record[alias] = values.dueAt;
  else if (alias in values) record.dueAt = record[alias];
  return values;
}

export async function create(input: NewItem): Promise<Item> {
  const createdAt = input.createdAt ?? nowISO();
  const draft = {
    ...input,
    id: input.id ?? newId(),
    createdAt,
    updatedAt: createdAt,
    status: input.status ?? 'active',
    personIds: input.personIds ?? [],
    projectIds: input.projectIds ?? [],
    tags: input.tags ?? [],
    ...(input.kind === 'decision' && { alternatives: input.alternatives ?? [], reasons: input.reasons ?? [] }),
    ...(input.kind === 'idea' && { stage: input.stage ?? 'spark', relatedIds: input.relatedIds ?? [] }),
  } as Item;
  const item = normalizeItem(syncDue(draft.kind, draft));
  await db.items.add(item);
  return item;
}

export async function get(id: ID): Promise<Item | undefined> {
  return db.items.get(id);
}

/** Live items for the ids, in the order asked; missing and trashed ones are left out. */
export async function getMany(ids: readonly ID[]): Promise<Item[]> {
  return (await db.items.bulkGet([...ids])).filter(isLive);
}

export async function update(id: ID, patch: ItemPatch): Promise<Item> {
  const previous = await db.items.get(id);
  if (!previous) throw new NotFoundError('items', id);
  return patchRecord('items', id, syncDue(previous.kind, { ...patch }) as Partial<Item>, normalizeItem);
}

export async function setStatus(id: ID, status: ItemStatus): Promise<Item> {
  return patchRecord('items', id, { status }, normalizeItem);
}

// ───────── Review of proposed items ─────────

/**
 * A capture in `review` becomes `done` as soon as nothing proposed is left to decide.
 * Runs inside the caller's transaction.
 */
async function settleCapture(captureId: ID): Promise<void> {
  const capture = await db.captures.get(captureId);
  if (!capture || capture.status !== 'review') return;
  const pending = await db.items
    .where('captureId')
    .equals(captureId)
    .filter((item) => item.status === 'proposed' && notDeleted(item))
    .count();
  if (pending === 0) await patchRecord('captures', captureId, { status: 'done' });
}

/**
 * Invariant 1: review turns `proposed` into `active`. Optional `edits` are applied in the same write.
 * Idempotent: an item that is no longer proposed is returned untouched.
 */
export async function accept(id: ID, edits: ItemPatch = {}): Promise<Item> {
  return db.transaction('rw', db.items, db.captures, async () => {
    const item = await db.items.get(id);
    if (!item) throw new NotFoundError('items', id);
    if (item.status !== 'proposed') return item;
    const accepted = await patchRecord('items', id, { ...syncDue(item.kind, { ...edits }), status: 'active' } as Partial<Item>, normalizeItem);
    if (item.captureId) await settleCapture(item.captureId);
    return accepted;
  });
}

/** `proposed` → `dismissed`. Idempotent; other statuses are left alone. */
export async function dismiss(id: ID): Promise<Item> {
  return db.transaction('rw', db.items, db.captures, async () => {
    const item = await db.items.get(id);
    if (!item) throw new NotFoundError('items', id);
    if (item.status !== 'proposed') return item;
    const dismissed = await patchRecord('items', id, { status: 'dismissed' }, normalizeItem);
    if (item.captureId) await settleCapture(item.captureId);
    return dismissed;
  });
}

async function resolveAllProposed(captureId: ID, status: 'active' | 'dismissed'): Promise<Item[]> {
  return db.transaction('rw', db.items, db.captures, async () => {
    const proposed = await db.items
      .where('captureId')
      .equals(captureId)
      .filter((item) => item.status === 'proposed' && notDeleted(item))
      .toArray();
    const resolved: Item[] = [];
    for (const item of proposed) resolved.push(await patchRecord('items', item.id, { status }, normalizeItem));
    await settleCapture(captureId);
    return resolved.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  });
}

/** "Принять всё": every proposed item of the capture becomes active. */
export const acceptAll = (captureId: ID): Promise<Item[]> => resolveAllProposed(captureId, 'active');
export const dismissAll = (captureId: ID): Promise<Item[]> => resolveAllProposed(captureId, 'dismissed');

/**
 * Pipeline write: stores `drafts` as `proposed` items of the capture, replacing the capture's earlier
 * proposals. Accepted, dismissed and edited items are never touched, so reprocessing is idempotent.
 * Draft timestamps are spread over consecutive milliseconds to keep the extraction order.
 */
export async function replaceProposed(captureId: ID, drafts: readonly NewItem[]): Promise<Item[]> {
  return db.transaction('rw', db.items, async () => {
    // Proposals were never accepted, so there is nothing to leave a tombstone for.
    await db.items
      .where('captureId')
      .equals(captureId)
      .filter((item) => item.status === 'proposed')
      .delete();
    const base = Date.now();
    const created: Item[] = [];
    for (const [index, draft] of drafts.entries()) {
      created.push(
        await create({ ...draft, captureId, status: 'proposed', createdAt: draft.createdAt ?? new Date(base + index).toISOString() }),
      );
    }
    return created;
  });
}

// ───────── Closing ─────────

function requireKind<K extends ItemKind>(item: Item | undefined, kind: K, id: ID): ItemOfKind<K> {
  if (!item || item.kind !== kind) throw new NotFoundError('items', id);
  return item as ItemOfKind<K>;
}

/** Invariant 5: the outcome sets `resolvedAt`. `unknown` closes the prediction without scoring it. */
export async function resolvePrediction(id: ID, outcome: PredictionOutcome, note?: string): Promise<ItemOfKind<'prediction'>> {
  requireKind(await db.items.get(id), 'prediction', id);
  const resolved = await patchRecord(
    'items',
    id,
    { outcome, resolvedAt: nowISO(), resolutionNote: note, status: 'done' } as Partial<Item>,
    normalizeItem,
  );
  return requireKind(resolved, 'prediction', id);
}

/** "Как оно вышло?": records how a decision turned out and closes it. */
export async function closeDecision(
  id: ID,
  { rating, note = '' }: { rating: DecisionRating; note?: string },
): Promise<ItemOfKind<'decision'>> {
  requireKind(await db.items.get(id), 'decision', id);
  const outcome: DecisionOutcome = { rating, note, at: nowISO() };
  const closed = await patchRecord('items', id, { outcome, status: 'done' } as Partial<Item>, normalizeItem);
  return requireKind(closed, 'decision', id);
}

/** Back to `active`; a prediction or decision forgets its outcome. */
export async function reopen(id: ID): Promise<Item> {
  const item = await db.items.get(id);
  if (!item) throw new NotFoundError('items', id);
  const patch: Partial<Item> =
    item.kind === 'prediction'
      ? ({ status: 'active', outcome: undefined, resolvedAt: undefined, resolutionNote: undefined } as Partial<Item>)
      : item.kind === 'decision'
        ? ({ status: 'active', outcome: undefined } as Partial<Item>)
        : { status: 'active' };
  return patchRecord('items', id, patch, normalizeItem);
}

// ───────── Queries ─────────

function matches(item: Item, filter: ItemFilter): boolean {
  const kinds = asList(filter.kind);
  const statuses = asList(filter.status);
  return (
    notDeleted(item) &&
    (!kinds || kinds.includes(item.kind)) &&
    (!statuses || statuses.includes(item.status)) &&
    (!filter.personId || item.personIds.includes(filter.personId)) &&
    (!filter.projectId || item.projectIds.includes(filter.projectId)) &&
    (!filter.captureId || item.captureId === filter.captureId) &&
    (!filter.tag || item.tags.includes(filter.tag))
  );
}

/** Picks the most selective index for a filter; the full predicate is applied afterwards. */
function startingCollection(filter: ItemFilter) {
  const kinds = asList(filter.kind);
  const statuses = asList(filter.status);
  const [kind] = kinds ?? [];
  const [status] = statuses ?? [];
  if (filter.captureId) return db.items.where('captureId').equals(filter.captureId);
  if (kind && status && kinds?.length === 1 && statuses?.length === 1) {
    return db.items.where('[kind+status]').equals([kind, status]);
  }
  if (kind && kinds?.length === 1) return db.items.where('kind').equals(kind);
  if (status && statuses?.length === 1) return db.items.where('status').equals(status);
  if (filter.personId) return db.items.where('personIds').equals(filter.personId);
  if (filter.projectId) return db.items.where('projectIds').equals(filter.projectId);
  return db.items.toCollection();
}

/** Items matching the filter (trashed ones excluded), newest first. */
export async function list(filter: ItemFilter = {}): Promise<Item[]> {
  const items = await startingCollection(filter)
    .filter((item) => matches(item, filter))
    .toArray();
  return items.sort(byCreatedDesc);
}

export async function listByKind<K extends ItemKind>(kind: K, filter: Omit<ItemFilter, 'kind'> = {}): Promise<ItemOfKind<K>[]> {
  return (await list({ ...filter, kind })) as ItemOfKind<K>[];
}

/** Items waiting for review, in extraction order (all captures, or one). */
export async function listProposed(captureId?: ID): Promise<Item[]> {
  const proposed = await list({ status: 'proposed', ...(captureId && { captureId }) });
  return proposed.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countProposed(): Promise<number> {
  return db.items
    .where('status')
    .equals('proposed')
    .filter(notDeleted)
    .count();
}

/** Everything extracted from or attached to a capture, in extraction order. */
export async function listByCapture(captureId: ID): Promise<Item[]> {
  return (await list({ captureId })).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const byDueThenNewest = (a: Item, b: Item): number =>
  (a.dueAt ?? '￿').localeCompare(b.dueAt ?? '￿') || byCreatedDesc(a, b);

/** Open commitments, nearest deadline first (no deadline last); optionally one direction. */
export async function listOpenCommitments(direction?: CommitmentDirection): Promise<ItemOfKind<'commitment'>[]> {
  const commitments = await listByKind('commitment', { status: 'active' });
  return commitments.filter((item) => !direction || item.direction === direction).sort(byDueThenNewest);
}

/** Open predictions whose resolution date has come (`dueAt <= until`, default now), oldest first. */
export async function listPredictionsToResolve(until: ISODate = nowISO()): Promise<ItemOfKind<'prediction'>[]> {
  const predictions = await listByKind('prediction', { status: 'active' });
  return predictions
    .filter((item) => item.outcome === undefined && item.dueAt !== undefined && item.dueAt <= until)
    .sort(byDueThenNewest);
}

/** Active decisions whose review date has come (`dueAt <= until`, default now) and that have no outcome yet. */
export async function listDecisionsToReview(until: ISODate = nowISO()): Promise<ItemOfKind<'decision'>[]> {
  const decisions = await listByKind('decision', { status: 'active' });
  return decisions
    .filter((item) => item.outcome === undefined && item.dueAt !== undefined && item.dueAt <= until)
    .sort(byDueThenNewest);
}

/** Active items due in `[from, to)`, soonest first. */
export async function listDueBetween(from: ISODate, to: ISODate): Promise<Item[]> {
  const items = await db.items
    .where('dueAt')
    .between(from, to, true, false)
    .filter((item) => item.status === 'active' && notDeleted(item))
    .toArray();
  return items.sort(byDueThenNewest);
}

// ───────── Deletion ─────────

/** Moves an item to the trash. */
export async function remove(id: ID): Promise<Item> {
  return db.transaction('rw', db.items, db.captures, async () => {
    const item = await softDeleteRecord('items', id);
    if (item.captureId) await settleCapture(item.captureId);
    return item;
  });
}

export async function restore(id: ID): Promise<Item> {
  return restoreRecord('items', id);
}

/**
 * Deletes an item for good (trash purge): the row, its links, a tombstone.
 * Ids that other items keep (`duplicateOf`, `relatedIds`, …) may dangle; readers treat them as absent.
 */
export async function destroy(id: ID): Promise<void> {
  await db.transaction('rw', db.items, db.links, db.tombstones, async () => {
    await db.items.delete(id);
    await links.removeFor(id);
    await db.tombstones.put({ id, table: 'items', deletedAt: nowISO() });
  });
}
