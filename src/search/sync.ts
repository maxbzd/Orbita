import type { Table, Transaction } from 'dexie';
import { db } from '../db';
import type { OrbitDB } from '../db';
import type { ID } from '../domain/types';
import { SEARCH_KIND_OF_TABLE, entryOf, searchKey } from './documents';
import type { SearchEntry, SearchTable, SearchableRecords } from './documents';
import { SearchIndex } from './engine';

/** The application-wide index: `search()` and the functions below work on it unless told otherwise. */
export const searchIndex = new SearchIndex();

const TABLES = Object.keys(SEARCH_KIND_OF_TABLE) as SearchTable[];

type Table_<T extends SearchTable> = Table<SearchableRecords[T], ID>;
const tableOf = <T extends SearchTable>(database: OrbitDB, name: T): Table_<T> => database[name] as unknown as Table_<T>;

/** A record that appeared, changed or is gone; `updateIndex` applies it without touching the database. */
export type IndexChange =
  | { [T in SearchTable]: { type: 'upsert'; table: T; record: SearchableRecords[T] } }[SearchTable]
  | { type: 'remove'; table: SearchTable; id: ID };

/** Applies changes to the index. A trashed capture or a dismissed item given as an upsert is removed. */
export function updateIndex(change: IndexChange | readonly IndexChange[], index: SearchIndex = searchIndex): void {
  const upserts: SearchEntry[] = [];
  const removals: string[] = [];
  for (const one of Array.isArray(change) ? (change as readonly IndexChange[]) : [change as IndexChange]) {
    if (one.type === 'remove') {
      removals.push(searchKey(SEARCH_KIND_OF_TABLE[one.table], one.id));
      continue;
    }
    const entry = entryOf(one.table, one.record);
    if (entry) upserts.push(entry);
    else removals.push(searchKey(SEARCH_KIND_OF_TABLE[one.table], one.record.id));
  }
  index.update(upserts, removals);
}

/**
 * Brings the index in line with the database: indexes new and changed records, forgets the ones
 * that are gone or trashed. Cheap to repeat (unchanged records are skipped), so it is also the way to
 * catch up after changes the hooks cannot see (another tab, a backup import). Returns the index size.
 */
export async function buildIndex(database: OrbitDB = db, index: SearchIndex = searchIndex): Promise<number> {
  const perTable = await Promise.all(
    TABLES.map(async (name) => {
      const records = await tableOf(database, name).toArray();
      return records.map((record) => entryOf(name, record));
    }),
  );
  const entries = perTable.flat().filter((entry): entry is SearchEntry => entry !== undefined);

  const present = new Set(entries.map((entry) => entry.key));
  index.update(
    entries.filter((entry) => index.versionOf(entry.key) !== entry.version),
    index.keys().filter((key) => !present.has(key)),
  );
  return index.size;
}

type Touched = Map<SearchTable, Set<ID>>;

/** Re-reads touched records and puts the committed state into the index. */
async function applyTouched(database: OrbitDB, index: SearchIndex, touched: Touched): Promise<void> {
  const upserts: SearchEntry[] = [];
  const removals: string[] = [];
  for (const [name, idSet] of touched) {
    const ids = [...idSet];
    const records = await tableOf(database, name).bulkGet(ids);
    ids.forEach((id, position) => {
      const record = records[position];
      const entry = record && entryOf(name, record);
      if (entry) upserts.push(entry);
      else removals.push(searchKey(SEARCH_KIND_OF_TABLE[name], id));
    });
  }
  index.update(upserts, removals);
}

export interface IndexSync {
  /** Unsubscribes from the database. */
  stop(): void;
}

/**
 * Keeps the index current: Dexie hooks note every record written in a transaction, and once the
 * transaction has committed the records are re-read and re-indexed (an aborted transaction leaves
 * the index alone). Re-reading instead of using the hook payload makes the result independent of
 * how the write was made (`put`, `update`, `modify`, bulk operations, `clear`).
 *
 * Only this tab's writes are seen: call `buildIndex` to catch up with other tabs.
 */
export function startIndexSync(
  database: OrbitDB = db,
  index: SearchIndex = searchIndex,
  onError: (error: unknown) => void = console.error,
): IndexSync {
  const open = new WeakMap<Transaction, Touched>();
  // Flushes run one after another, so an older read can never overwrite a newer one.
  let queue: Promise<void> = Promise.resolve();

  const touch = (name: SearchTable, id: ID, transaction: Transaction): void => {
    let touched = open.get(transaction);
    if (!touched) {
      const created: Touched = new Map();
      touched = created;
      open.set(transaction, created);
      transaction.on('complete', () => {
        queue = queue.then(() => applyTouched(database, index, created)).catch(onError);
      });
    }
    const ids = touched.get(name) ?? new Set<ID>();
    ids.add(id);
    touched.set(name, ids);
  };

  const unsubscribers = TABLES.map((name) => {
    const table = tableOf(database, name);
    const onCreating = (primKey: ID, _record: unknown, transaction: Transaction): void => {
      touch(name, primKey, transaction);
    };
    const onUpdating = (_changes: object, primKey: ID, _record: unknown, transaction: Transaction): void => {
      touch(name, primKey, transaction);
    };
    const onDeleting = (primKey: ID, _record: unknown, transaction: Transaction): void => {
      touch(name, primKey, transaction);
    };
    table.hook('creating', onCreating);
    table.hook('updating', onUpdating);
    table.hook('deleting', onDeleting);
    return () => {
      table.hook('creating').unsubscribe(onCreating);
      table.hook('updating').unsubscribe(onUpdating);
      table.hook('deleting').unsubscribe(onDeleting);
    };
  });

  return {
    stop() {
      for (const unsubscribe of unsubscribers) unsubscribe();
    },
  };
}

let starting: Promise<void> | undefined;

/**
 * Starts the application index once: subscribes to the database first (so nothing slips through
 * while it loads), then builds it. Safe to call from several places; a failed start can be retried.
 */
export function ensureSearchIndex(): Promise<void> {
  starting ??= (async () => {
    startIndexSync();
    await buildIndex();
  })().catch((error: unknown) => {
    starting = undefined;
    throw error;
  });
  return starting;
}
