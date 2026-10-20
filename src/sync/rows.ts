import type { Table } from 'dexie';
import { db } from '../db';
import type { Capture, ID, ISODate } from '../domain/types';

/** Tables that travel to the cloud. Settings (keys, lock) and unfinished recording chunks never do. */
export const SYNC_TABLES = ['tombstones', 'captures', 'items', 'people', 'projects', 'checkins', 'patterns', 'reviews', 'profile', 'presets', 'links', 'usage'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

/** Rows carrying `updatedAt`: the later version wins on both sides. */
export const VERSIONED_TABLES = ['captures', 'items', 'people', 'projects', 'checkins', 'patterns', 'reviews', 'profile'] as const;
export type VersionedTable = (typeof VERSIONED_TABLES)[number];
/** Rows that never change after creation: presets, links, usage. Only the missing ones are added. */
export const APPEND_TABLES = ['presets', 'links', 'usage'] as const;

export const isSyncTable = (value: string): value is SyncTable => (SYNC_TABLES as readonly string[]).includes(value);

export interface RowLike {
  id: ID;
  updatedAt?: ISODate;
  deletedAt?: ISODate;
  isDemo?: boolean;
}

export const tableOf = (name: SyncTable): Table<RowLike, ID> => db[name] as unknown as Table<RowLike, ID>;

/** Key sorted JSON, so the same content always has the same text. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** A short fingerprint of a record's content (FNV-1a, 32 bit; only compared with itself). */
export function fingerprint(value: unknown): string {
  const text = stable(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `h${(hash >>> 0).toString(36)}.${text.length}`;
}

/**
 * What identifies one state of a record. Versioned rows: their `updatedAt`; tombstones: their `deletedAt`;
 * rows that never change: a fingerprint of the content.
 */
export function versionOf(table: SyncTable, row: unknown): string {
  const record = row as { updatedAt?: unknown; deletedAt?: unknown };
  if ((VERSIONED_TABLES as readonly string[]).includes(table) && typeof record.updatedAt === 'string') return record.updatedAt;
  if (table === 'tombstones' && typeof record.deletedAt === 'string') return record.deletedAt;
  return fingerprint(row);
}

export const metaKey = (table: SyncTable, id: ID): string => `${table}:${id}`;

/**
 * Whether a record stays on this device for now: demo data, and a capture that is still being made
 * (the empty shell the recorder creates, a record in the middle of transcription or extraction).
 */
export function isLocalOnly(table: SyncTable, row: RowLike): boolean {
  if (row.isDemo === true) return true;
  if (table !== 'captures') return false;
  const capture = row as unknown as Capture;
  if (capture.status === 'transcribing' || capture.status === 'extracting') return true;
  return capture.kind === 'voice' && capture.status === 'raw' && capture.text === '' && capture.audioId === undefined;
}
