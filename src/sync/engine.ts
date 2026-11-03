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

/** One record on its way up. `ver`, `base` and `target` stay readable by the server even when `data` is sealed. */
export interface OutRow {
  tbl: SyncTable;
  id: ID;
  data: unknown;
  /** The record's own version (`updatedAt`, or `deletedAt` of a tombstone): what the server orders edits by. */
  ver?: string;
  /** The version of the cloud copy this edit was made on top of. The server refuses the write if the cloud moved on. */
  base?: string;
  /** Tombstones: the table of the record they delete. */
  target?: string;
}

export interface UpsertResult {
  /** `table:id` of rows the server did not write because the cloud copy changed since `base`: pull, merge, send again. */
  conflicts: string[];
}

export class E2ELockedError extends Error {
  constructor() {
    super(t('The cloud data is encrypted and this device does not have the key.'));
    this.name = 'E2ELockedError';
  }
}

export interface SyncBackend {
  readonly userId: string;
  /** Writes whole records. The server keeps the later `ver` of each, and refuses an edit whose `base` is out of date. */
  upsert(rows: OutRow[]): Promise<UpsertResult | void>;
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
/** How many times one round re-reads and re-sends after the server refused an out-of-date edit. */
const MAX_TURNS = 4;

/**
 * What each row looked like when this device and the cloud last agreed on it (`base:<table>:<id>` in the sync bookkeeping).
 * It is the common ancestor of a three-way merge, so that two devices editing different fields of one record both keep
 * their edit. Rows over this size (long transcripts) are not kept: those merge by "the newer wins", as before.
 */
const BASE_PREFIX = 'base:';
const BASE_LIMIT = 150_000;
const baseOf = (table: SyncTable, row: unknown): { id: string; v: string } | null => {
  const text = JSON.stringify(row);
  return text.length <= BASE_LIMIT ? { id: `${BASE_PREFIX}${metaKey(table, (row as RowLike).id)}`, v: text } : null;
};

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

/**
 * Marks every record and recording as not yet sent, keeping the cursor and the account: the next push sends them all
 * again. Used when the way records are stored in the cloud changes (sealing them), where the version stamps stay the same.
 */
export async function markAllUnsent(): Promise<void> {
  const keep = (id: string): boolean => id.startsWith('@') || id.startsWith(BASE_PREFIX);
  const ids = (await db.syncmeta.toCollection().primaryKeys()).filter((id) => !keep(String(id)));
  await db.syncmeta.bulkDelete(ids);
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

/**
 * A row edited here since the last sync and also changed in the cloud is merged field by field with the version both
 * sides last agreed on. The merged row is stamped newer than both, so it is sent on this same round and the other
 * devices take it as it is. With no base (a row never synced, or too large), the usual rule stands: the newer wins.
 */
async function mergeLocalEdits(
  table: VersionedTable,
  list: RowLike[],
  mergeRecords: typeof import('./merge').mergeRecords,
): Promise<{ list: RowLike[]; remoteOf: Map<ID, RowLike> }> {
  const remoteOf = new Map<ID, RowLike>();
  const locals = await (tableOf(table) as Table<RowLike, ID>).bulkGet(list.map((row) => row.id));
  const metas = await db.syncmeta.bulkGet(list.flatMap((row) => [metaKey(table, row.id), `${BASE_PREFIX}${metaKey(table, row.id)}`]));
  const merged = list.map((remote, index) => {
    const local = locals[index];
    const known = metas[index * 2]?.v;
    const base = metas[index * 2 + 1]?.v;
    if (!local || known === undefined || base === undefined) return remote;
    if (versionOf(table, local) === known) return remote; // nothing edited here: the cloud's version simply replaces
    if (remote.updatedAt === undefined || local.updatedAt === undefined || remote.updatedAt <= known) return remote; // nothing new in the cloud
    const result = mergeRecords(JSON.parse(base) as Record<string, unknown>, local as unknown as Record<string, unknown>, remote as unknown as Record<string, unknown>, {
      localTs: Date.parse(local.updatedAt),
      remoteTs: Date.parse(remote.updatedAt),
    });
    // newer than both, so it wins the cloud's "newer version" rule and travels on
    const newest = Math.max(Date.parse(local.updatedAt), Date.parse(remote.updatedAt), Date.now());
    const row = { ...result.value, id: remote.id, updatedAt: new Date(newest + 1).toISOString() } as unknown as RowLike;
    remoteOf.set(remote.id, remote);
    return row;
  });
  return { list: merged, remoteOf };
}

/** Merges rows from the cloud into the database in one transaction. Returns how many changed this device. */
async function applyIncoming(rows: readonly RemoteRow[]): Promise<{ applied: number; rejected: number }> {
  const incoming = parseRows(rows);
  let applied = 0;
  // loaded before the transaction (waiting for a module inside one would end it), and only if a row could need it
  const { mergeRecords } = await import('./merge');

  await db.transaction('rw', allTables(), async () => {
    const meta: { id: string; v: string }[] = [];
    const metaDrop: string[] = [];

    // Tombstones first: they decide which incoming rows are still alive.
    const tombstones = new Map<ID, ISODate>((await db.tombstones.toArray()).map(({ id, deletedAt }) => [id, deletedAt]));
    const tomb = await applyTombstones(incoming.tombstones, tombstones);
    applied += tomb.added + tomb.updated;
    for (const tombstone of incoming.tombstones) {
      meta.push({ id: metaKey('tombstones', tombstone.id), v: tombstone.deletedAt });
      metaDrop.push(metaKey(tombstone.table as SyncTable, tombstone.id), `${BASE_PREFIX}${metaKey(tombstone.table as SyncTable, tombstone.id)}`);
    }

    const written: ID[] = [];
    const audioLost: ID[] = [];
    for (const table of VERSIONED_TABLES) {
      const list = incoming.versioned.get(table);
      if (!list || list.length === 0) continue;
      const mine: ID[] = [];
      const prepared = await mergeLocalEdits(table, list, mergeRecords);
      const result = await mergeVersioned(
        db[table] as never as Parameters<typeof mergeVersioned>[0],
        prepared.list as never,
        tombstones,
        mine,
      );
      applied += result.added + result.updated;
      written.push(...mine);
      const byId = new Map(prepared.list.map((row) => [row.id, row]));
      // A row the cloud holds in a version this device did not take (its own copy is newer): the cloud copy is still what
      // the next edit is built on, so remember it, or the server would keep refusing the send as out of date.
      const kept = new Set(mine);
      const rest = list.filter((row) => !kept.has(row.id));
      if (rest.length > 0) {
        const held = await (tableOf(table) as Table<RowLike, ID>).bulkGet(rest.map((row) => row.id));
        rest.forEach((row, index) => {
          const mineNow = held[index];
          // only where this device's copy is the newer one (an equal copy is simply in step, and stays as it is)
          if (mineNow?.updatedAt !== undefined && row.updatedAt !== undefined && mineNow.updatedAt > row.updatedAt && !tombstones.has(row.id)) {
            meta.push({ id: metaKey(table, row.id), v: versionOf(table, row) });
          }
        });
      }
      for (const id of mine) {
        // a merged row stays "not yet sent": what the cloud is known to have is the version it just sent us
        const row = prepared.remoteOf.get(id) ?? byId.get(id);
        if (row) {
          meta.push({ id: metaKey(table, id), v: versionOf(table, row) });
          const base = baseOf(table, row);
          if (base) meta.push(base);
          else metaDrop.push(`${BASE_PREFIX}${metaKey(table, id)}`);
        }
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
  /** What the cloud had when this edit began (versioned tables, once the row has been synced). */
  base?: string;
}

async function collectDirty(): Promise<Dirty[]> {
  const known = new Map((await db.syncmeta.toArray()).map(({ id, v }) => [id, v]));
  const dirty: Dirty[] = [];
  for (const tbl of SYNC_TABLES) {
    for (const row of await tableOf(tbl).toArray()) {
      if (isLocalOnly(tbl, row)) continue;
      const version = versionOf(tbl, row);
      if (known.get(metaKey(tbl, row.id)) === version) continue;
      const base = (VERSIONED_TABLES as readonly string[]).includes(tbl) ? known.get(metaKey(tbl, row.id)) : undefined;
      dirty.push({ tbl, id: row.id, data: row, version, ...(base !== undefined ? { base } : {}) });
    }
  }
  // Tombstones go first, so a record is never sent after its own deletion.
  return dirty.sort((a, b) => Number(b.tbl === 'tombstones') - Number(a.tbl === 'tombstones'));
}

/** The fields the server orders and checks edits by; they stay readable when the record itself is sealed. */
function outRow({ tbl, id, data, version, base }: Dirty): OutRow {
  const ordered = tbl === 'tombstones' || (VERSIONED_TABLES as readonly string[]).includes(tbl);
  return {
    tbl,
    id,
    data,
    ...(ordered ? { ver: version } : {}),
    ...(base !== undefined ? { base } : {}),
    ...(tbl === 'tombstones' ? { target: (data as Tombstone).table } : {}),
  };
}

async function pushDirty(backend: SyncBackend, signal: AbortSignal | undefined): Promise<{ sent: number; conflicts: number }> {
  const dirty = await collectDirty();
  let sent = 0;
  let conflicts = 0;
  // Batches of up to BATCH records and about BATCH_CHARS of text: a long monologue must not make one huge request.
  let batch: Dirty[] = [];
  let size = 0;
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    throwIfAborted(signal);
    const sending = batch;
    batch = [];
    size = 0;
    const result = await backend.upsert(sending.map(outRow));
    const refused = new Set(result?.conflicts ?? []);
    const accepted = sending.filter(({ tbl, id }) => !refused.has(metaKey(tbl, id)));
    conflicts += sending.length - accepted.length;
    sent += accepted.length;
    await db.syncmeta.bulkPut(accepted.flatMap(({ tbl, id, version, data }) => {
      const base = baseOf(tbl, data);
      return [{ id: metaKey(tbl, id), v: version }, ...(base ? [base] : [])];
    }));
  };
  for (const row of dirty) {
    const length = JSON.stringify(row.data).length;
    if (batch.length >= BATCH || (batch.length > 0 && size + length > BATCH_CHARS)) await flush();
    batch.push(row);
    size += length;
  }
  await flush();
  return { sent, conflicts };
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
  let pushed = 0;
  if (push) {
    // Another device may have written between our reading and our writing: the server then refuses that record, we read
    // again (which merges the two edits) and send the merged one. A few turns are enough; the next round finishes the rest.
    for (let turn = 0; turn < MAX_TURNS; turn += 1) {
      const result = await pushDirty(backend, signal);
      pushed += result.sent;
      if (result.conflicts === 0) break;
      const again = await pullAll(backend, signal);
      pulled.pulled += again.pulled;
      pulled.applied += again.applied;
      pulled.rejected += again.rejected;
    }
  }
  const audio = await syncAudio(backend, signal, push);
  return { pushed, pulled: pulled.pulled, applied: pulled.applied, rejected: pulled.rejected, audioUp: audio.up, audioDown: audio.down };
}
