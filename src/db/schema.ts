import Dexie from 'dexie';
import { normalizePersonRole } from '../domain/types';
import type { DBCore, DexieOptions, EntityTable, Transaction } from 'dexie';
import { reportWriteFailure, resolveFull, useStorageHealth } from '../lib/storageHealth';
import { backendFactory, backendKeyRange, initBackend } from '../vault/backend';
import type {
  AudioBlob,
  AudioChunk,
  Capture,
  CheckIn,
  ContextPackPreset,
  Item,
  Link,
  Pattern,
  Person,
  Profile,
  Project,
  Review,
  Settings,
  SyncMeta,
  Tombstone,
  UsageRow,
} from '../domain/types';

export const DB_NAME = 'orbita';

/**
 * Version 1 — docs/DATA_MODEL.md "Таблицы Dexie и индексы", plus `chunks` (ARCHITECTURE: MediaRecorder
 * chunks are written to IndexedDB every 10 s, the contract had no table for them).
 * First name in each string is the primary key; `*` is a multi-entry index, `[a+b]` a compound one.
 */
export const STORES_V1 = {
  captures: 'id, day, status, kind, createdAt, *personIds, *projectIds, *tags',
  audio: 'id, captureId',
  chunks: 'id, captureId, [captureId+seq]',
  items: 'id, kind, status, [kind+status], captureId, dueAt, *personIds, *projectIds, createdAt',
  people: 'id, name, role, lastMentionAt',
  projects: 'id, status',
  checkins: 'id, day, at',
  patterns: 'id, status, lastSeenDay',
  reviews: 'id, [period+startDay]',
  profile: 'id',
  settings: 'id',
  usage: 'id, at',
  presets: 'id',
  links: 'id, from, to',
  tombstones: 'id, table',
} as const;

export interface SchemaVersion {
  version: number;
  /** Only the tables that changed since the previous version (`null` drops a table). */
  stores: Readonly<Record<string, string | null>>;
  /** Data migration; runs inside the upgrade transaction with every table available. */
  upgrade?: (tx: Transaction) => void | Promise<void>;
}

/**
 * Append-only history of the schema. To change it: add a new entry with the next version number
 * (never edit a released one) and cover the `upgrade` with a test on data in the previous shape.
 */
export const SCHEMA_VERSIONS: readonly SchemaVersion[] = [
  { version: 1, stores: STORES_V1 },
  // Cloud sync bookkeeping (src/sync): which version of each record the cloud is known to have. Local only.
  { version: 2, stores: { syncmeta: 'id' } },
  // Person roles were narrowed to neutral ones; the old ones become their closest equivalent.
  {
    version: 3,
    stores: {},
    upgrade: async (tx) => {
      await tx.table('people').toCollection().modify((person: { role?: unknown }) => {
        person.role = normalizePersonRole(person.role);
      });
    },
  },
];

export function applyVersions(dexie: Dexie, versions: readonly SchemaVersion[]): void {
  for (const { version, stores, upgrade } of [...versions].sort((a, b) => a.version - b.version)) {
    const definition = dexie.version(version).stores(stores as Record<string, string | null>);
    if (upgrade) definition.upgrade(upgrade);
  }
}

export type OrbitDB = Dexie & {
  captures: EntityTable<Capture, 'id'>;
  audio: EntityTable<AudioBlob, 'id'>;
  chunks: EntityTable<AudioChunk, 'id'>;
  items: EntityTable<Item, 'id'>;
  people: EntityTable<Person, 'id'>;
  projects: EntityTable<Project, 'id'>;
  checkins: EntityTable<CheckIn, 'id'>;
  patterns: EntityTable<Pattern, 'id'>;
  reviews: EntityTable<Review, 'id'>;
  profile: EntityTable<Profile, 'id'>;
  settings: EntityTable<Settings, 'id'>;
  usage: EntityTable<UsageRow, 'id'>;
  presets: EntityTable<ContextPackPreset, 'id'>;
  links: EntityTable<Link, 'id'>;
  tombstones: EntityTable<Tombstone, 'id'>;
  syncmeta: EntityTable<SyncMeta, 'id'>;
};

/** A database instance; tests use their own names for isolation. */
export function createDb(name: string = DB_NAME, versions: readonly SchemaVersion[] = SCHEMA_VERSIONS, options?: DexieOptions): OrbitDB {
  const dexie = new Dexie(name, options) as OrbitDB;
  applyVersions(dexie, versions);
  // Every write passes here: a refusal for lack of room is announced to the person (see StorageBanner), and still thrown,
  // so the caller knows the change was not saved. A failed write changes nothing (the transaction is rolled back).
  dexie.use({
    stack: 'dbcore',
    name: 'storage-guard',
    create: (down: DBCore): DBCore => ({
      ...down,
      table: (tableName: string) => {
        const table = down.table(tableName);
        return {
          ...table,
          // `.then` on the promise Dexie gave us, not async/await: a native promise in the middle would let a transaction
          // commit before the rest of its work has run
          mutate: (req) =>
            table.mutate(req).then(
              (result) => {
                // writes work again (room was made, or the browser allowed more): the notice has done its job
                if (useStorageHealth.getState().full) resolveFull();
                return result;
              },
              (error: unknown) => {
                reportWriteFailure(error);
                throw error;
              },
            ),
        };
      },
    }),
  });
  return dexie;
}

/** The application database. */
// The storage underneath is chosen when the database is first opened: the browser's own, or (with encryption on) a memory copy.
initBackend('orbita.vault');
export const db = createDb(DB_NAME, SCHEMA_VERSIONS, { indexedDB: backendFactory, IDBKeyRange: backendKeyRange });
