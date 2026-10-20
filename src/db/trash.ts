import { nowISO } from '../domain/dates';
import { truncate } from '../domain/text';
import type { ID, ISODate } from '../domain/types';
import type { RowTableName, RowTables } from './internal';
import * as captures from './repos/captures';
import * as checkins from './repos/checkins';
import * as items from './repos/items';
import * as patterns from './repos/patterns';
import * as people from './repos/people';
import * as projects from './repos/projects';
import * as reviews from './repos/reviews';
import { db } from './schema';
import { t } from '../i18n';

/** Soft-deleted records stay in the trash this long (docs/DATA_MODEL.md). */
export const TRASH_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export type TrashTable = RowTableName;

export interface TrashEntry {
  table: TrashTable;
  id: ID;
  /** What to show in the trash list. */
  title: string;
  deletedAt: ISODate;
}

interface TrashSource {
  table: TrashTable;
  list(): Promise<TrashEntry[]>;
  restore(id: ID): Promise<unknown>;
  destroy(id: ID): Promise<void>;
}

const isTrashed = <T extends { deletedAt?: ISODate }>(record: T): boolean => record.deletedAt !== undefined;

function source<K extends TrashTable>(
  table: K,
  rows: () => Promise<RowTables[K][]>,
  title: (record: RowTables[K]) => string,
  operations: { restore(id: ID): Promise<unknown>; destroy(id: ID): Promise<void> },
): TrashSource {
  return {
    table,
    async list() {
      return (await rows()).flatMap((record) =>
        record.deletedAt === undefined ? [] : [{ table, id: record.id, title: title(record), deletedAt: record.deletedAt }],
      );
    },
    // Picked one by one: `operations` is a whole repository module, which has its own `list`.
    restore: operations.restore,
    destroy: operations.destroy,
  };
}

/**
 * Order matters for purges: captures go first, because destroying one also removes its proposed items,
 * so the later `items` pass never sees them.
 */
const SOURCES: readonly TrashSource[] = [
  source(
    'captures',
    () => db.captures.filter(isTrashed).toArray(),
    (capture) => capture.title?.trim() || truncate(capture.text.trim(), 80) || t('Record without text'),
    captures,
  ),
  source('items', () => db.items.filter(isTrashed).toArray(), (item) => item.title, items),
  source('people', () => db.people.filter(isTrashed).toArray(), (person) => person.name, people),
  source('projects', () => db.projects.filter(isTrashed).toArray(), (project) => project.name, projects),
  source(
    'checkins',
    () => db.checkins.filter(isTrashed).toArray(),
    (checkIn) => truncate(checkIn.note?.trim() ?? '', 80) || t('State'),
    checkins,
  ),
  source('patterns', () => db.patterns.filter(isTrashed).toArray(), (pattern) => pattern.title, patterns),
  source('reviews', () => db.reviews.filter(isTrashed).toArray(), (review) => review.headline || t('Review'), reviews),
];

const sourceOf = (table: TrashTable): TrashSource => {
  const found = SOURCES.find((candidate) => candidate.table === table);
  if (!found) throw new RangeError(t('Unknown trash table: {table}', { table }));
  return found;
};

/** Everything in the trash, most recently deleted first. */
export async function listTrash(): Promise<TrashEntry[]> {
  const entries = (await Promise.all(SOURCES.map((trashSource) => trashSource.list()))).flat();
  return entries.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export async function countTrash(): Promise<number> {
  return (await listTrash()).length;
}

/** Takes one record out of the trash. */
export async function restoreFromTrash({ table, id }: Pick<TrashEntry, 'table' | 'id'>): Promise<void> {
  await sourceOf(table).restore(id);
}

/** Deletes one trashed record for good (what "Удалить навсегда" does). */
export async function destroyFromTrash({ table, id }: Pick<TrashEntry, 'table' | 'id'>): Promise<void> {
  await sourceOf(table).destroy(id);
}

async function purgeWhere(predicate: (entry: TrashEntry) => boolean): Promise<number> {
  let purged = 0;
  for (const trashSource of SOURCES) {
    // The list is read per source, after the previous sources were purged (see SOURCES).
    for (const entry of await trashSource.list()) {
      if (!predicate(entry)) continue;
      await trashSource.destroy(entry.id);
      purged += 1;
    }
  }
  return purged;
}

/**
 * Deletes for good everything that has been in the trash for `olderThanDays` or longer (default 30).
 * Returns how many trash entries were purged (what a purge removes along with them, such as the
 * proposals of a deleted capture, is not counted).
 */
export async function purgeTrash({
  olderThanDays = TRASH_RETENTION_DAYS,
  now = nowISO(),
}: { olderThanDays?: number; now?: ISODate } = {}): Promise<number> {
  const cutoff = new Date(Date.parse(now) - olderThanDays * DAY_MS).toISOString();
  return purgeWhere((entry) => entry.deletedAt <= cutoff);
}

/** "Очистить корзину": deletes everything in the trash for good. */
export const emptyTrash = (): Promise<number> => purgeWhere(() => true);
