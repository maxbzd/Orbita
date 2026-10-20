import type { EntityTable, Table } from 'dexie';
import { z } from 'zod';
import { localDayKey, nowISO } from '../domain/dates';
import {
  captureSchema,
  checkInSchema,
  idSchema,
  isoDateSchema,
  itemSchema,
  linkSchema,
  patternSchema,
  personSchema,
  presetSchema,
  profileSchema,
  projectSchema,
  reviewSchema,
  sealedDataSchema,
  tombstoneSchema,
  usageRowSchema,
} from '../domain/schemas';
import type {
  AudioBlob,
  Capture,
  CheckIn,
  ContextPackPreset,
  ID,
  ISODate,
  Item,
  Link,
  Pattern,
  Person,
  Profile,
  Project,
  Review,
  SealedData,
  Settings,
  Tombstone,
  UsageRow,
} from '../domain/types';
import { CryptoError, openText, sealText } from './crypto';
import { base64ToBlob, blobToBase64 } from './encoding';
import { allTables } from './internal';
import { recomputeMentions } from './repos/people';
import { SCHEMA_VERSIONS, db } from './schema';
import { SETTINGS_ID, normalizeSettings } from './settings';
import { t } from '../i18n';

/**
 * Backup file `orbit-backup-v1`: one JSON document with every table. Either plain
 * (`encrypted: false`, readable and diffable) or sealed with a password (`encrypted: true`, the plain
 * document as AES-GCM ciphertext, see crypto.ts). Audio is optional and travels as base64.
 * Not included: unfinished recording chunks (transient).
 */
export const BACKUP_FORMAT = 'orbit-backup-v1';

/** Schema version of the database the backup was taken from (a newer one cannot be imported). */
const CURRENT_SCHEMA_VERSION = Math.max(...SCHEMA_VERSIONS.map(({ version }) => version));

// ───────── Format ─────────

/** An audio recording inside a backup: the `audio` row with the Blob as base64 in `data`. */
export interface BackupAudio extends Omit<AudioBlob, 'data'> {
  data: string;
}

export interface BackupTables {
  captures: Capture[];
  items: Item[];
  people: Person[];
  projects: Project[];
  checkins: CheckIn[];
  patterns: Pattern[];
  reviews: Review[];
  profile: Profile | null;
  settings: Settings | null;
  usage: UsageRow[];
  presets: ContextPackPreset[];
  links: Link[];
  tombstones: Tombstone[];
  audio: BackupAudio[];
}

export interface PlainBackup {
  format: typeof BACKUP_FORMAT;
  encrypted: false;
  exportedAt: ISODate;
  schemaVersion: number;
  includesAudio: boolean;
  tables: BackupTables;
}

export interface EncryptedBackup {
  format: typeof BACKUP_FORMAT;
  encrypted: true;
  exportedAt: ISODate;
  sealed: SealedData;
}

export type BackupFile = PlainBackup | EncryptedBackup;

const audioEntrySchema = z.object({
  id: idSchema,
  captureId: idSchema,
  mime: z.string(),
  sizeBytes: z.number().int().min(0),
  data: z.string(),
  chunks: z.number().int().min(0).optional(),
  createdAt: isoDateSchema,
}) satisfies z.ZodType<BackupAudio>;

const rows = <T extends z.ZodType>(schema: T) => z.array(schema).default([]);

const plainBackupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  encrypted: z.literal(false),
  exportedAt: isoDateSchema,
  schemaVersion: z.number().int().min(1).default(1),
  includesAudio: z.boolean().default(false),
  tables: z.object({
    captures: rows(captureSchema),
    items: rows(itemSchema),
    people: rows(personSchema),
    projects: rows(projectSchema),
    checkins: rows(checkInSchema),
    patterns: rows(patternSchema),
    reviews: rows(reviewSchema),
    profile: profileSchema.nullable().default(null),
    // Settings are repaired rather than rejected: anything invalid becomes its default.
    settings: z
      .unknown()
      .optional()
      .transform((raw): Settings | null => (raw === undefined || raw === null ? null : normalizeSettings(raw))),
    usage: rows(usageRowSchema),
    presets: rows(presetSchema),
    links: rows(linkSchema),
    tombstones: rows(tombstoneSchema),
    audio: rows(audioEntrySchema),
  }),
}) satisfies z.ZodType<PlainBackup>;

const encryptedBackupSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  encrypted: z.literal(true),
  exportedAt: isoDateSchema,
  sealed: sealedDataSchema,
}) satisfies z.ZodType<EncryptedBackup>;

// ───────── Errors ─────────

export type BackupErrorCode =
  | 'invalid_json'
  | 'not_a_backup'
  | 'unsupported_version'
  | 'invalid_data'
  | 'password_required'
  | 'wrong_password';

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

function describeIssue(error: z.ZodError): string {
  const [issue] = error.issues;
  if (!issue) return t('unknown error');
  const path = issue.path.map((part) => (typeof part === 'number' ? `[${part}]` : `.${String(part)}`)).join('').replace(/^\./, '');
  return path ? `${path}: ${issue.message}` : issue.message;
}

// ───────── Export ─────────

export interface ExportOptions {
  /** Put the audio recordings into the file (it grows a lot). Default `false`. */
  includeAudio?: boolean;
  /**
   * Keep API keys (and the sealed copy made by the lock) in the settings. Default `false` for a
   * plain file, `true` for an encrypted one.
   */
  includeSecrets?: boolean;
}

export interface EncryptedExportOptions extends ExportOptions {
  /** PBKDF2 work factor (at least 210 000); the default is the app-wide one. */
  iterations?: number;
}

/** Settings without anything secret: API keys blanked, no sealed copy of them. */
export function redactSecrets(settings: Settings): Settings {
  return {
    ...settings,
    ai: {
      ...settings.ai,
      anthropic: { ...settings.ai.anthropic, apiKey: '' },
      openaiCompat: { ...settings.ai.openaiCompat, apiKey: '' },
    },
    stt: { ...settings.stt, apiKey: '' },
    lock: { ...settings.lock, sealedSecrets: null },
  };
}

/** Everything in the database as one consistent snapshot. */
export async function exportBackup({ includeAudio = false, includeSecrets = false }: ExportOptions = {}): Promise<PlainBackup> {
  // Blobs are only read here; they are turned into base64 after the transaction, because waiting for
  // a non-Dexie promise inside it would let it commit early.
  const snapshot = await db.transaction('r', allTables(), async () => ({
    captures: await db.captures.toArray(),
    items: await db.items.toArray(),
    people: await db.people.toArray(),
    projects: await db.projects.toArray(),
    checkins: await db.checkins.toArray(),
    patterns: await db.patterns.toArray(),
    reviews: await db.reviews.toArray(),
    profile: (await db.profile.toArray())[0] ?? null,
    settings: (await db.settings.get(SETTINGS_ID)) ?? null,
    usage: await db.usage.toArray(),
    presets: await db.presets.toArray(),
    links: await db.links.toArray(),
    tombstones: await db.tombstones.toArray(),
    audio: includeAudio ? await db.audio.toArray() : [],
  }));

  const { audio, settings, ...rest } = snapshot;
  const normalized = settings ? normalizeSettings(settings) : null;
  return {
    format: BACKUP_FORMAT,
    encrypted: false,
    exportedAt: nowISO(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    includesAudio: includeAudio,
    tables: {
      ...rest,
      settings: normalized && !includeSecrets ? redactSecrets(normalized) : normalized,
      audio: await Promise.all(
        audio.map(async ({ data, ...meta }) => ({ ...meta, data: await blobToBase64(data) })),
      ),
    },
  };
}

/** Same content as `exportBackup`, sealed with the password (AES-256-GCM, PBKDF2-SHA256). */
export async function exportEncryptedBackup(
  password: string,
  { iterations, includeSecrets = true, ...options }: EncryptedExportOptions = {},
): Promise<EncryptedBackup> {
  if (password === '') throw new BackupError('password_required', t('Enter a password to encrypt the backup.'));
  const plain = await exportBackup({ ...options, includeSecrets });
  return {
    format: BACKUP_FORMAT,
    encrypted: true,
    exportedAt: plain.exportedAt,
    sealed: await sealText(password, JSON.stringify(plain), iterations === undefined ? undefined : { iterations }),
  };
}

export function serializeBackup(file: BackupFile): string {
  const readable = !file.encrypted && !file.includesAudio;
  return JSON.stringify(file, null, readable ? 2 : undefined);
}

/** `orbita-backup-2026-10-07.json` (`….enc.json` for a sealed copy), by the local day of the export. */
export function backupFileName(file: Pick<BackupFile, 'encrypted' | 'exportedAt'>): string {
  return `orbita-backup-${localDayKey(file.exportedAt)}${file.encrypted ? '.enc' : ''}.json`;
}

// ───────── Reading ─────────

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new BackupError('invalid_json', t('This is not an Orbita backup: the file cannot be parsed as JSON.'));
  }
}

function assertBackupEnvelope(value: unknown): asserts value is { format: string; encrypted?: unknown; schemaVersion?: unknown } {
  const format = typeof value === 'object' && value !== null ? (value as { format?: unknown }).format : undefined;
  if (typeof format !== 'string' || !format.startsWith('orbit-backup-')) {
    throw new BackupError('not_a_backup', t('This is not an Orbita backup.'));
  }
  if (format !== BACKUP_FORMAT) {
    throw new BackupError('unsupported_version', t('The backup format “{format}” is not supported by this version of the app.', { format }));
  }
}

function parsePlain(value: unknown): PlainBackup {
  const result = plainBackupSchema.safeParse(value);
  if (!result.success) {
    throw new BackupError('invalid_data', t('The backup is damaged ({describeIssue}).', { describeIssue: describeIssue(result.error) }));
  }
  if (result.data.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new BackupError('unsupported_version', t('The backup was made in a newer version of the app. Update Orbita.'));
  }
  return result.data;
}

export interface BackupInfo {
  encrypted: boolean;
  exportedAt: ISODate;
}

/** Cheap look at a file before importing it: is it a backup, and does it need a password? */
export function inspectBackup(text: string): BackupInfo {
  const value = parseJson(text);
  assertBackupEnvelope(value);
  const { exportedAt } = value as { exportedAt?: unknown };
  if (typeof value.encrypted !== 'boolean' || !isoDateSchema.safeParse(exportedAt).success) {
    throw new BackupError('invalid_data', t('The backup is damaged (no date or encryption flag).'));
  }
  return { encrypted: value.encrypted, exportedAt: exportedAt as ISODate };
}

/**
 * Parses and validates a backup file (decrypting it when needed) without touching the database.
 * @throws BackupError
 */
export async function readBackup(text: string, password?: string): Promise<PlainBackup> {
  const value = parseJson(text);
  assertBackupEnvelope(value);
  if (value.encrypted !== true) return parsePlain(value);

  const envelope = encryptedBackupSchema.safeParse(value);
  if (!envelope.success) {
    throw new BackupError('invalid_data', t('The backup is damaged ({describeIssue}).', { describeIssue: describeIssue(envelope.error) }));
  }
  if (!password) throw new BackupError('password_required', t('The backup is encrypted: enter the password.'));

  let inner: string;
  try {
    inner = await openText(password, envelope.data.sealed);
  } catch (error) {
    if (error instanceof CryptoError && error.code === 'wrong_password') {
      throw new BackupError('wrong_password', t('Wrong password or the file is damaged.'));
    }
    throw error;
  }
  const decrypted = parseJson(inner);
  assertBackupEnvelope(decrypted);
  return parsePlain(decrypted);
}

// ───────── Import ─────────

/**
 * - `merge`: adds what is missing and keeps, for rows that exist on both sides, the one changed last
 *   (`updatedAt`); records deleted for good on either side (tombstones) stay deleted unless edited
 *   later. Settings are taken from the file only when this device has none.
 * - `replace`: wipes the database first; afterwards it holds exactly the file's content.
 */
export type ImportMode = 'merge' | 'replace';

export interface ImportOptions {
  mode?: ImportMode;
  /** Required for an encrypted file. */
  password?: string;
}

export interface TableCounts {
  added: number;
  updated: number;
  skipped: number;
}

export interface ImportReport {
  mode: ImportMode;
  byTable: Record<keyof BackupTables, TableCounts>;
  added: number;
  updated: number;
  skipped: number;
}

/** The table with its plain row type: `EntityTable` also wants the primary key left out on insert. */
const rowsOf = <T extends { id: ID }>(table: EntityTable<T, 'id'>): Table<T, ID> => table as unknown as Table<T, ID>;

const counts = (): TableCounts => ({ added: 0, updated: 0, skipped: 0 });

/** Rows with `updatedAt`: the newer side wins, a tombstone newer than the row wins over it. Also used by cloud sync. */
export async function mergeVersioned<T extends { id: ID; updatedAt: ISODate }>(
  table: EntityTable<T, 'id'>,
  incoming: readonly T[],
  tombstones: ReadonlyMap<ID, ISODate>,
  written: ID[],
): Promise<TableCounts> {
  const store = rowsOf(table);
  const result = counts();
  const existing = await store.bulkGet(incoming.map((record) => record.id));
  const accepted: T[] = [];
  incoming.forEach((record, index) => {
    const deletedAt = tombstones.get(record.id);
    if (deletedAt !== undefined && deletedAt >= record.updatedAt) {
      result.skipped += 1;
      return;
    }
    const local = existing[index];
    if (local === undefined) result.added += 1;
    else if (record.updatedAt > local.updatedAt) result.updated += 1;
    else {
      result.skipped += 1;
      return;
    }
    accepted.push(record);
  });
  // No write at all when nothing is accepted: an empty write still tells live queries and sync that something changed.
  if (accepted.length > 0) await store.bulkPut(accepted);
  written.push(...accepted.map((record) => record.id));
  return result;
}

/** Rows that never change after creation (usage, presets, links): only the missing ones are added. Also used by cloud sync. */
export async function mergeMissing<T extends { id: ID }>(table: EntityTable<T, 'id'>, incoming: readonly T[]): Promise<TableCounts> {
  const store = rowsOf(table);
  const result = counts();
  const existing = await store.bulkGet(incoming.map((record) => record.id));
  const accepted = incoming.filter((_, index) => existing[index] === undefined);
  if (accepted.length > 0) await store.bulkPut(accepted);
  result.added = accepted.length;
  result.skipped = incoming.length - accepted.length;
  return result;
}

/** Keeps this device's API keys when the file carries none (a plain backup has them blanked). */
function keepLocalSecrets(incoming: Settings, local: Settings | undefined): Settings {
  if (!local) return incoming;
  const current = normalizeSettings(local);
  // The lock belongs to the device, not to the file: a backup without one must not switch off this device's lock
  // (and lose the sealed keys), and one with a lock must not leave plain keys next to it.
  if (current.lock.enabled && !incoming.lock.enabled) return { ...incoming, lock: current.lock };
  if (incoming.lock.enabled) return incoming;
  return {
    ...incoming,
    ai: {
      ...incoming.ai,
      anthropic: { ...incoming.ai.anthropic, apiKey: incoming.ai.anthropic.apiKey || current.ai.anthropic.apiKey },
      openaiCompat: {
        ...incoming.ai.openaiCompat,
        apiKey: incoming.ai.openaiCompat.apiKey || current.ai.openaiCompat.apiKey,
      },
    },
    stt: { ...incoming.stt, apiKey: incoming.stt.apiKey || current.stt.apiKey },
  };
}

/**
 * Imports a backup (file text or an already read one) in a single transaction: on any failure the
 * database stays as it was. Throws `BackupError` for a bad file or password.
 */
export async function importBackup(source: string | PlainBackup, { mode = 'merge', password }: ImportOptions = {}): Promise<ImportReport> {
  const backup = typeof source === 'string' ? await readBackup(source, password) : parsePlain(source);
  const { tables } = backup;
  // Decoding happens before the transaction: it must not wait on anything but Dexie.
  const audio: AudioBlob[] = tables.audio.map(({ data, ...meta }) => ({ ...meta, data: base64ToBlob(data, meta.mime) }));

  const byTable = {} as Record<keyof BackupTables, TableCounts>;

  await db.transaction('rw', allTables(), async () => {
    const previousSettings = mode === 'replace' ? await db.settings.get(SETTINGS_ID) : undefined;
    if (mode === 'replace') await Promise.all(db.tables.map((table) => table.clear()));

    // Tombstones first: they decide which incoming rows are still alive.
    const tombstones = new Map<ID, ISODate>((await db.tombstones.toArray()).map(({ id, deletedAt }) => [id, deletedAt]));
    byTable.tombstones = await applyTombstones(tables.tombstones, tombstones);

    const written: ID[] = [];
    byTable.captures = await mergeVersioned(db.captures, tables.captures, tombstones, written);
    byTable.items = await mergeVersioned(db.items, tables.items, tombstones, written);
    byTable.people = await mergeVersioned(db.people, tables.people, tombstones, written);
    byTable.projects = await mergeVersioned(db.projects, tables.projects, tombstones, written);
    byTable.checkins = await mergeVersioned(db.checkins, tables.checkins, tombstones, written);
    byTable.patterns = await mergeVersioned(db.patterns, tables.patterns, tombstones, written);
    byTable.reviews = await mergeVersioned(db.reviews, tables.reviews, tombstones, written);
    // A row edited after its tombstone was written is alive again.
    await db.tombstones.bulkDelete(written.filter((id) => tombstones.has(id)));

    byTable.profile = await mergeProfile(tables.profile);
    byTable.settings = await mergeSettings(tables.settings, previousSettings);
    byTable.usage = await mergeMissing(db.usage, tables.usage);
    byTable.presets = await mergeMissing(db.presets, tables.presets);
    byTable.links = await mergeMissing(db.links, tables.links);
    byTable.audio = await mergeAudio(audio);

    await dropDanglingAudioIds();
    await recomputeMentions();
  });

  const totals = Object.values(byTable);
  return {
    mode,
    byTable,
    added: totals.reduce((sum, entry) => sum + entry.added, 0),
    updated: totals.reduce((sum, entry) => sum + entry.updated, 0),
    skipped: totals.reduce((sum, entry) => sum + entry.skipped, 0),
  };
}

/**
 * Stores incoming tombstones (the newest per id wins) and removes local rows that are not newer than
 * their tombstone. `tombstones` is updated to the effective set. Also used by cloud sync.
 */
export async function applyTombstones(incoming: readonly Tombstone[], tombstones: Map<ID, ISODate>): Promise<TableCounts> {
  const result = counts();
  const rowTables = {
    captures: db.captures,
    items: db.items,
    people: db.people,
    projects: db.projects,
    checkins: db.checkins,
    patterns: db.patterns,
    reviews: db.reviews,
  } as const;

  const accepted: Tombstone[] = [];
  for (const tombstone of incoming) {
    const known = tombstones.get(tombstone.id);
    if (known !== undefined && known >= tombstone.deletedAt) {
      result.skipped += 1;
      continue;
    }
    const table = rowTables[tombstone.table as keyof typeof rowTables] as
      | { get(id: ID): PromiseLike<{ updatedAt: ISODate } | undefined>; delete(id: ID): PromiseLike<void> }
      | undefined;
    const local = await table?.get(tombstone.id);
    if (local !== undefined && local.updatedAt > tombstone.deletedAt) {
      // Edited here after it was deleted there: the row lives on.
      result.skipped += 1;
      continue;
    }
    if (local !== undefined) {
      await table?.delete(tombstone.id);
      if (tombstone.table === 'captures') {
        await db.audio.where('captureId').equals(tombstone.id).delete();
        await db.chunks.where('captureId').equals(tombstone.id).delete();
      }
    }
    tombstones.set(tombstone.id, tombstone.deletedAt);
    accepted.push(tombstone);
    if (known === undefined) result.added += 1;
    else result.updated += 1;
  }
  if (accepted.length > 0) await db.tombstones.bulkPut(accepted);
  return result;
}

async function mergeProfile(incoming: Profile | null): Promise<TableCounts> {
  if (!incoming) return counts();
  return mergeVersioned(db.profile, [incoming], new Map(), []);
}

/** Only fills settings in when this device has none (or after a `replace`): settings are per device. */
async function mergeSettings(incoming: Settings | null, previous: Settings | undefined): Promise<TableCounts> {
  if (!incoming) return counts();
  if (await db.settings.get(SETTINGS_ID)) return { added: 0, updated: 0, skipped: 1 };
  await db.settings.put(keepLocalSecrets(incoming, previous));
  return { added: 1, updated: 0, skipped: 0 };
}

/** Audio rows whose capture exists and that are not stored yet. */
async function mergeAudio(incoming: readonly AudioBlob[]): Promise<TableCounts> {
  const captures = await db.captures.bulkGet(incoming.map(({ captureId }) => captureId));
  const withCapture = incoming.filter((_, index) => captures[index] !== undefined);
  const result = await mergeMissing(db.audio, withCapture);
  result.skipped += incoming.length - withCapture.length;
  return result;
}

/** Captures must not point at audio that is not there (a backup without audio, a skipped row). */
async function dropDanglingAudioIds(): Promise<void> {
  const withAudio = await db.captures.filter((capture) => capture.audioId !== undefined).toArray();
  const audio = await db.audio.bulkGet(withAudio.map((capture) => capture.audioId as ID));
  const repaired = withAudio.flatMap((capture, index) => {
    if (audio[index] !== undefined) return [];
    const { audioId: _missing, ...rest } = capture;
    return [rest];
  });
  await db.captures.bulkPut(repaired);
}
