import type { Table } from 'dexie';
import type { ZodType } from 'zod';
import { applyTombstones, db, mergeMissing, mergeVersioned } from '../db';
import { allTables } from '../db/internal';
import { recomputeMentions } from '../db/repos/people';
import {
  captureSchema,
  checkInSchema,
  itemSchema,
  linkSchema,
  patternSchema,
  personSchema,
  presetSchema,
  profileSchema,
  projectSchema,
  reviewSchema,
  tombstoneSchema,
  usageRowSchema,
} from '../domain/schemas';
import type { ID, ISODate, Tombstone } from '../domain/types';
import { APPEND_TABLES, SYNC_TABLES, VERSIONED_TABLES, isLocalOnly, metaKey, tableOf, versionOf } from './rows';
import type { RowLike, SyncTable, VersionedTable } from './rows';
import { t } from '../i18n';

// ───────── What the engine needs from a server ─────────

export interface RemoteRow {
  tbl: SyncTable;
  id: ID;
  data: unknown;
  /** Server clock; the pull cursor. */
  updated_at: string;
}

export interface SyncBackend {
  readonly userId: string;
  /** Writes whole records. The server keeps the later `updatedAt` / `deletedAt` of each. */
  upsert(rows: { tbl: SyncTable; id: ID; data: unknown }[]): Promise<void>;
  /** Rows changed at or after `since` (everything when `null`), oldest first, at most `limit`. */
  pull(since: string | null, limit: number): Promise<RemoteRow[]>;
  /** Capture ids that have a recording in the cloud. */
  listAudio(): Promise<Set<ID>>;
  uploadAudio(captureId: ID, blob: Blob): Promise<void>;
  /** `null` when there is none. */
  downloadAudio(captureId: ID): Promise<Blob | null>;
  removeAudio(captureIds: ID[]): Promise<void>;
}

export class AccountMismatchError extends Error {
  constructor() {
    super(t("This device holds another account's data."));
    this.name = 'AccountMismatchError';
  }
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  /** Pulled rows that changed this device. */
  applied: number;
  /** Pulled rows that did not fit the schema (a newer app version wrote them). */
  rejected: number;
  audioUp: number;
  audioDown: number;
}

export interface SyncOptions {
  /** Look through the local data for changes to send. Without it only the cloud is read. */
  push?: boolean;
  signal?: AbortSignal;
}

const PAGE = 500;
const BATCH = 100;
const BATCH_CHARS = 400_000;
/** Rows are read again from a little before the cursor: transactions may become visible out of order. */
const OVERLAP_MS = 15_000;

const CURSOR = '@cursor';
const USER = '@user';
const AUDIO_PREFIX = 'audio:';

const SCHEMAS: Record<SyncTable, ZodType> = {
  tombstones: tombstoneSchema,
  captures: captureSchema,
  items: itemSchema,
  people: personSchema,
  projects: projectSchema,
  checkins: checkInSchema,
  patterns: patternSchema,
  reviews: reviewSchema,
  profile: profileSchema,
  presets: presetSchema,
  links: linkSchema,
  usage: usageRowSchema,
};

const metaValue = async (id: string): Promise<string | undefined> => (await db.syncmeta.get(id))?.v;

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException(t('Sync cancelled'), 'AbortError');
}

// ───────── Account ─────────

/** Remembers whose data lives on this device. A different account must not receive it by accident. */
async function checkAccount(backend: SyncBackend): Promise<void> {
  const known = await metaValue(USER);
  if (known === backend.userId) return;
  if (known !== undefined) throw new AccountMismatchError();
  await db.syncmeta.put({ id: USER, v: backend.userId });
}

/** The user chose how to treat data of another account: `merge` keeps and shares it, `replace` clears the device first. */
export async function adoptAccount(backend: Pick<SyncBackend, 'userId'>, mode: 'merge' | 'replace'): Promise<void> {
  await db.transaction('rw', allTables(), async () => {
    if (mode === 'replace') {
      for (const table of db.tables) if (table.name !== 'settings') await table.clear();
    } else {
      await db.syncmeta.clear();
    }
    await db.syncmeta.put({ id: USER, v: backend.userId });
  });
}

/** Forgets what is known about the cloud (sign out for good, wipe): the next sign-in treats everything as new. */
export async function forgetCloud(): Promise<void> {
  await db.syncmeta.clear();
}

// ───────── Pull ─────────

interface Incoming {
  tombstones: Tombstone[];
  versioned: Map<VersionedTable, RowLike[]>;
  append: Map<(typeof APPEND_TABLES)[number], RowLike[]>;
  rejected: number;
}

function parseRows(rows: readonly RemoteRow[]): Incoming {
  const incoming: Incoming = { tombstones: [], versioned: new Map(), append: new Map(), rejected: 0 };
  for (const row of rows) {
    const parsed = SCHEMAS[row.tbl]?.safeParse(row.data);
    if (!parsed?.success) {
      incoming.rejected += 1;
      continue;
    }
    const value = parsed.data as RowLike;
    if (row.tbl === 'tombstones') incoming.tombstones.push(value as unknown as Tombstone);
    else if ((VERSIONED_TABLES as readonly string[]).includes(row.tbl)) {
      const list = incoming.versioned.get(row.tbl as VersionedTable) ?? [];
      list.push(value);
      incoming.versioned.set(row.tbl as VersionedTable, list);
    } else {
      const list = incoming.append.get(row.tbl as (typeof APPEND_TABLES)[number]) ?? [];
      list.push(value);
      incoming.append.set(row.tbl as (typeof APPEND_TABLES)[number], list);
    }
  }
  return incoming;
}

/** Merges rows from the cloud into the database in one transaction. Returns how many changed this device. */
async function applyIncoming(rows: readonly RemoteRow[]): Promise<{ applied: number; rejected: number }> {
  const incoming = parseRows(rows);
  let applied = 0;

  await db.transaction('rw', allTables(), async () => {
    const meta: { id: string; v: string }[] = [];
    const metaDrop: string[] = [];

    // Tombstones first: they decide which incoming rows are still alive.
    const tombstones = new Map<ID, ISODate>((await db.tombstones.toArray()).map(({ id, deletedAt }) => [id, deletedAt]));
    const tomb = await applyTombstones(incoming.tombstones, tombstones);
    applied += tomb.added + tomb.updated;
    for (const tombstone of incoming.tombstones) {
      meta.push({ id: metaKey('tombstones', tombstone.id), v: tombstone.deletedAt });
      metaDrop.push(metaKey(tombstone.table as SyncTable, tombstone.id));
    }

    const written: ID[] = [];
    const audioLost: ID[] = [];
    for (const table of VERSIONED_TABLES) {
      const list = incoming.versioned.get(table);
      if (!list || list.length === 0) continue;
      const mine: ID[] = [];
      const result = await mergeVersioned(
        db[table] as never as Parameters<typeof mergeVersioned>[0],
        list as never,
        tombstones,
        mine,
      );
      applied += result.added + result.updated;
      written.push(...mine);
      const byId = new Map(list.map((row) => [row.id, row]));
      for (const id of mine) {
        const row = byId.get(id);
        if (row) meta.push({ id: metaKey(table, id), v: versionOf(table, row) });
        // The recording was removed on the other device: drop the copy here too.
        if (table === 'captures' && row && (row as unknown as { audioId?: ID }).audioId === undefined) audioLost.push(id);
      }
    }
    // A row edited after its tombstone was written is alive again.
    const revived = written.filter((id) => tombstones.has(id));
    if (revived.length > 0) await db.tombstones.bulkDelete(revived);
    for (const captureId of audioLost) {
      await db.audio.where('captureId').equals(captureId).delete();
      metaDrop.push(`${AUDIO_PREFIX}${captureId}`);
    }

    for (const table of APPEND_TABLES) {
      const list = incoming.append.get(table);
      if (!list || list.length === 0) continue;
      const result = await mergeMissing(db[table] as never as Parameters<typeof mergeMissing>[0], list as never);
      applied += result.added;
      // Whatever this device holds now counts as the same state as the cloud: no ping-pong on a differing copy.
      const current = await (tableOf(table) as Table<RowLike, ID>).bulkGet(list.map((row) => row.id));
      current.forEach((row, index) => {
        const id = list[index]?.id;
        if (row && id) meta.push({ id: metaKey(table, id), v: versionOf(table, row) });
      });
    }

    if (written.length > 0 || tomb.added + tomb.updated > 0) await recomputeMentions();
    if (metaDrop.length > 0) await db.syncmeta.bulkDelete(metaDrop);
    if (meta.length > 0) await db.syncmeta.bulkPut(meta);
  });
  return { applied, rejected: incoming.rejected };
}

function earlier(iso: string, ms: number): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : new Date(time - ms).toISOString();
}

async function pullAll(backend: SyncBackend, signal: AbortSignal | undefined): Promise<{ pulled: number; applied: number; rejected: number }> {
  const cursor = await metaValue(CURSOR);
  let since: string | null = cursor ? earlier(cursor, OVERLAP_MS) : null;
  let newest = cursor;
  const total = { pulled: 0, applied: 0, rejected: 0 };
  for (;;) {
    throwIfAborted(signal);
    const page = await backend.pull(since, PAGE);
    if (page.length > 0) {
      const result = await applyIncoming(page);
      total.pulled += page.length;
      total.applied += result.applied;
      total.rejected += result.rejected;
      newest = page[page.length - 1]?.updated_at ?? newest;
    }
    if (page.length < PAGE) break;
    const next = page[page.length - 1]?.updated_at ?? null;
    if (next === since) break; // a full page of one instant: cannot move on, the overlap covers the rest
    since = next;
  }
  if (newest && newest !== cursor) await db.syncmeta.put({ id: CURSOR, v: newest });
  return total;
}

// ───────── Push ─────────

interface Dirty {
  tbl: SyncTable;
  id: ID;
  data: unknown;
  version: string;
}

async function collectDirty(): Promise<Dirty[]> {
  const known = new Map((await db.syncmeta.toArray()).map(({ id, v }) => [id, v]));
  const dirty: Dirty[] = [];
  for (const tbl of SYNC_TABLES) {
    for (const row of await tableOf(tbl).toArray()) {
      if (isLocalOnly(tbl, row)) continue;
      const version = versionOf(tbl, row);
      if (known.get(metaKey(tbl, row.id)) === version) continue;
      dirty.push({ tbl, id: row.id, data: row, version });
    }
  }
  // Tombstones go first, so a record is never sent after its own deletion.
  return dirty.sort((a, b) => Number(b.tbl === 'tombstones') - Number(a.tbl === 'tombstones'));
}

async function pushDirty(backend: SyncBackend, signal: AbortSignal | undefined): Promise<number> {
  const dirty = await collectDirty();
  // Batches of up to BATCH records and about BATCH_CHARS of text: a long monologue must not make one huge request.
  let batch: Dirty[] = [];
  let size = 0;
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    throwIfAborted(signal);
    const sending = batch;
    batch = [];
    size = 0;
    await backend.upsert(sending.map(({ tbl, id, data }) => ({ tbl, id, data })));
    await db.syncmeta.bulkPut(sending.map(({ tbl, id, version }) => ({ id: metaKey(tbl, id), v: version })));
  };
  for (const row of dirty) {
    const length = JSON.stringify(row.data).length;
    if (batch.length >= BATCH || (batch.length > 0 && size + length > BATCH_CHARS)) await flush();
    batch.push(row);
    size += length;
  }
  await flush();
  return dirty.length;
}

// ───────── Recordings ─────────

const audioTag = (audioId: ID, size: number): string => `${audioId}:${size}`;

/** Uploads new recordings, removes the ones deleted here, downloads the ones other devices made. */
async function syncAudio(backend: SyncBackend, signal: AbortSignal | undefined, push: boolean): Promise<{ up: number; down: number }> {
  let up = 0;
  let down = 0;
  const known = new Map((await db.syncmeta.where('id').startsWith(AUDIO_PREFIX).toArray()).map(({ id, v }) => [id.slice(AUDIO_PREFIX.length), v]));
  const local = await db.audio.toArray();
  const localByCapture = new Map(local.map((audio) => [audio.captureId, audio]));

  if (push) {
    for (const audio of local) {
      throwIfAborted(signal);
      const capture = await db.captures.get(audio.captureId);
      if (!capture || capture.isDemo === true) continue;
      const tag = audioTag(audio.id, audio.sizeBytes);
      if (known.get(audio.captureId) === tag) continue;
      await backend.uploadAudio(audio.captureId, audio.data);
      await db.syncmeta.put({ id: `${AUDIO_PREFIX}${audio.captureId}`, v: tag });
      up += 1;
    }
    // Had it once, has it no more: deleted here (or with its capture).
    const gone = [...known.keys()].filter((captureId) => !localByCapture.has(captureId));
    if (gone.length > 0) {
      await backend.removeAudio(gone);
      await db.syncmeta.bulkDelete(gone.map((captureId) => `${AUDIO_PREFIX}${captureId}`));
    }
  }

  const wanting = (await db.captures.filter((capture) => capture.audioId !== undefined && !capture.deletedAt).toArray()).filter(
    (capture) => !localByCapture.has(capture.id),
  );
  if (wanting.length > 0) {
    const inCloud = await backend.listAudio();
    for (const capture of wanting) {
      throwIfAborted(signal);
      if (!inCloud.has(capture.id) || capture.audioId === undefined) continue;
      const blob = await backend.downloadAudio(capture.id);
      if (!blob) continue;
      await db.transaction('rw', db.audio, db.syncmeta, db.captures, async () => {
        // The capture may have lost its recording while this one was coming down.
        const fresh = await db.captures.get(capture.id);
        if (!fresh || fresh.audioId !== capture.audioId) return;
        await db.audio.put({ id: capture.audioId as ID, captureId: capture.id, mime: blob.type || 'audio/webm', sizeBytes: blob.size, data: blob, createdAt: capture.createdAt });
        await db.syncmeta.put({ id: `${AUDIO_PREFIX}${capture.id}`, v: audioTag(capture.audioId as ID, blob.size) });
      });
      down += 1;
    }
  }
  return { up, down };
}

// ───────── One round ─────────

/**
 * One synchronisation: read what changed in the cloud and merge it in, then send what changed here,
 * then move recordings. Safe to repeat and to interrupt; the newer version of every record wins.
 * @throws AccountMismatchError when the device holds another account's data
 */
export async function runSync(backend: SyncBackend, { push = true, signal }: SyncOptions = {}): Promise<SyncReport> {
  await checkAccount(backend);
  const pulled = await pullAll(backend, signal);
  const pushed = push ? await pushDirty(backend, signal) : 0;
  const audio = await syncAudio(backend, signal, push);
  return { pushed, pulled: pulled.pulled, applied: pulled.applied, rejected: pulled.rejected, audioUp: audio.up, audioDown: audio.down };
}
