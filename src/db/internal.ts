import { nowISO } from '../domain/dates';
import type { Base, Capture, CheckIn, ID, ISODate, Item, Pattern, Person, Project, Review } from '../domain/types';
import { db } from './schema';
import { t } from '../i18n';

/** Shared plumbing of the repositories; not part of the public API. */

const ENTITY_NAMES: Record<string, string> = {
  get captures() { return t('Record') },
  get items() { return t('Object') },
  get people() { return t('Person') },
  get projects() { return t('Project') },
  get checkins() { return t('State') },
  get patterns() { return t('Pattern') },
  get reviews() { return t('Review') },
  get presets() { return t('Preset') },
  get links() { return t('Link') },
};

export class NotFoundError extends Error {
  constructor(
    readonly table: string,
    readonly id: ID,
  ) {
    super(t('{v} not found', { v: ENTITY_NAMES[table] ?? t('Record') }));
    // Not 'NotFoundError': Dexie maps errors with that name (an IndexedDB one) to its own class
    // when they cross a transaction, and `instanceof NotFoundError` would stop working.
    this.name = 'RecordNotFoundError';
  }
}

/** A record that exists and is not in the trash. */
export function isLive<T extends { deletedAt?: ISODate }>(record: T | undefined): record is T {
  return record !== undefined && record.deletedAt === undefined;
}

export const notDeleted = <T extends { deletedAt?: ISODate }>(record: T): boolean => record.deletedAt === undefined;

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** Newest first by `createdAt`. */
export const byCreatedDesc = <T extends { createdAt: ISODate }>(a: T, b: T): number =>
  b.createdAt.localeCompare(a.createdAt);

/**
 * Shallow patch where an explicit `undefined` removes the key (stored records stay free of
 * `undefined` placeholders and optional fields can be cleared).
 */
export function applyPatch<T extends object>(record: T, patch: Partial<T>): T {
  const next = { ...record } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as T;
}

/** Strips keys the caller must not set through a patch. */
export function withoutKeys<T extends object>(value: T, keys: readonly string[]): T {
  const copy = { ...value } as Record<string, unknown>;
  for (const key of keys) delete copy[key];
  return copy as T;
}

const IMMUTABLE_KEYS = ['id', 'createdAt'] as const;

/** Tables of soft-deletable entities (everything that extends `Base`), by name. */
export interface RowTables {
  captures: Capture;
  items: Item;
  people: Person;
  projects: Project;
  checkins: CheckIn;
  patterns: Pattern;
  reviews: Review;
}
export type RowTableName = keyof RowTables;

/** Untyped view of a row table: the helpers below put the types back through `RowTables`. */
interface LooseTable {
  get(id: ID): PromiseLike<Base | undefined>;
  put(record: Base): PromiseLike<unknown>;
  delete(id: ID): PromiseLike<void>;
}

const rows = (name: RowTableName): LooseTable => db[name] as unknown as LooseTable;

async function load<K extends RowTableName>(name: K, id: ID): Promise<RowTables[K]> {
  const record = await rows(name).get(id);
  if (!record) throw new NotFoundError(name, id);
  return record as RowTables[K];
}

/** Reads a record, applies the patch, bumps `updatedAt` and writes it back (inside the caller's transaction). */
export async function patchRecord<K extends RowTableName>(
  name: K,
  id: ID,
  patch: Partial<RowTables[K]>,
  normalize: (next: RowTables[K], previous: RowTables[K]) => RowTables[K] = (next) => next,
): Promise<RowTables[K]> {
  const previous = await load(name, id);
  const merged = applyPatch(previous, withoutKeys(patch, IMMUTABLE_KEYS));
  const next = normalize({ ...merged, updatedAt: nowISO() }, previous);
  await rows(name).put(next);
  return next;
}

export async function softDeleteRecord<K extends RowTableName>(name: K, id: ID): Promise<RowTables[K]> {
  const previous = await load(name, id);
  if (previous.deletedAt) return previous;
  const now = nowISO();
  const next = { ...previous, deletedAt: now, updatedAt: now };
  await rows(name).put(next);
  return next;
}

export async function restoreRecord<K extends RowTableName>(name: K, id: ID): Promise<RowTables[K]> {
  const previous = await load(name, id);
  if (!previous.deletedAt) return previous;
  const next = applyPatch(previous, { deletedAt: undefined, updatedAt: nowISO() } as Partial<RowTables[K]>);
  await rows(name).put(next);
  return next;
}

/** Writes a tombstone: the id is gone for good (future sync and backup merges rely on it). */
export async function recordTombstone(table: string, id: ID, deletedAt: ISODate = nowISO()): Promise<void> {
  await db.tombstones.put({ id, table, deletedAt });
}

/** Deletes a row for good and leaves a tombstone. */
export async function hardDelete(name: RowTableName, id: ID): Promise<void> {
  await rows(name).delete(id);
  await recordTombstone(name, id);
}

/** Every table: multi-table operations lock the whole (small, single-user) database. */
export const allTables = () => db.tables;
