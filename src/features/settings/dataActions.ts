import { generateReview, findPatterns } from '../../ai';
import type { LlmProvider } from '../../ai';
import {
  audioRepo,
  backupFileName,
  capturesRepo,
  exportBackup,
  exportEncryptedBackup,
  importBackup,
  inspectBackup,
  readBackup,
  serializeBackup,
  wipeAll,
} from '../../db';
import type { BackupInfo, ImportMode, ImportReport } from '../../db';
import { localDayKey } from '../../domain/dates';
import { initLock } from '../lock';
import { useCloud, wipeCloud } from '../../sync';

/** What the "Данные" group does, apart from the screen. Everything goes through the repositories of `src/db`. */

export interface BackupText {
  fileName: string;
  text: string;
}

/** A readable JSON copy. API keys are never in it. */
export async function makePlainBackup(includeAudio: boolean): Promise<BackupText> {
  const file = await exportBackup({ includeAudio, includeSecrets: false });
  return { fileName: backupFileName(file), text: serializeBackup(file) };
}

/** A copy sealed with a password (AES-256-GCM); the keys are inside it. */
export async function makeEncryptedBackup(password: string, includeAudio: boolean, iterations?: number): Promise<BackupText> {
  const file = await exportEncryptedBackup(password, { includeAudio, includeSecrets: true, iterations });
  return { fileName: backupFileName(file), text: serializeBackup(file) };
}

/** Starts a browser download of a text file. */
export function downloadText(fileName: string, text: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface BackupPreview {
  info: BackupInfo;
  /** Row counts per table; `null` while an encrypted file still needs its password. */
  counts: Record<string, number> | null;
}

/** Looks into a file before anything is imported: is it ours, does it need a password, what is inside. */
export async function previewBackup(text: string, password?: string): Promise<BackupPreview> {
  const info = inspectBackup(text);
  if (info.encrypted && !password) return { info, counts: null };
  const backup = await readBackup(text, password);
  const { tables } = backup;
  return {
    info,
    counts: {
      captures: tables.captures.length,
      items: tables.items.length,
      people: tables.people.length,
      projects: tables.projects.length,
      checkins: tables.checkins.length,
      patterns: tables.patterns.length,
      reviews: tables.reviews.length,
      audio: tables.audio.length,
    },
  };
}

/** Imports the file. After a replace the lock is read again: the file may carry its own password. */
export async function runImport(text: string, mode: ImportMode, password?: string): Promise<ImportReport> {
  const report = await importBackup(text, { mode, password });
  if (mode === 'replace') await initLock();
  return report;
}

export interface RawCleanup {
  recordings: number;
  rawTexts: number;
}

/** Counts what "Удалить сырьё" would remove. */
export async function countRawMaterial(): Promise<RawCleanup> {
  const captures = await capturesRepo.list();
  return {
    recordings: captures.filter((capture) => capture.audioId !== undefined).length,
    rawTexts: captures.filter((capture) => capture.rawText !== undefined).length,
  };
}

/**
 * Deletes the raw material: voice recordings and the original, unedited transcripts. The edited text, the objects
 * the AI extracted, people, patterns and reviews stay. Deliberately separate from `recomputeDerived`.
 */
export async function deleteRawMaterial(): Promise<RawCleanup> {
  const captures = await capturesRepo.list();
  const result: RawCleanup = { recordings: 0, rawTexts: 0 };
  for (const capture of captures) {
    if (capture.audioId !== undefined) {
      await audioRepo.remove(capture.id);
      result.recordings += 1;
    }
    if (capture.rawText !== undefined) {
      await capturesRepo.update(capture.id, { rawText: undefined });
      result.rawTexts += 1;
    }
  }
  return result;
}

export interface RecomputeResult {
  patternsCreated: number;
  patternsUpdated: number;
  reviews: number;
  /** The first provider error, if any (the rest of the run still happened). */
  error?: string;
}

/**
 * Rebuilds what the AI derives from the records: patterns, and the reviews of the current week and month.
 * The records, their objects and the audio are not touched. Costs tokens; the caller shows the usage.
 */
export async function recomputeDerived(llm: LlmProvider, now: Date = new Date(), signal?: AbortSignal): Promise<RecomputeResult> {
  const result: RecomputeResult = { patternsCreated: 0, patternsUpdated: 0, reviews: 0 };
  const today = localDayKey(now);
  try {
    const found = await findPatterns({ llm, now, signal });
    result.patternsCreated = found.created.length;
    result.patternsUpdated = found.updated.length;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  for (const period of ['week', 'month'] as const) {
    try {
      const review = await generateReview(period, today, { llm, now, signal });
      if (review.aiError && !result.error) result.error = review.aiError;
      result.reviews += 1;
    } catch (error) {
      result.error ??= error instanceof Error ? error.message : String(error);
    }
  }
  return result;
}

/** "Удалить всё": every table, the keys in memory, the lock, and the cloud copy when signed in. The app returns to its first launch. */
export async function eraseAll(): Promise<void> {
  // Signed in: the cloud copy goes first (and the sign-out with it), or the next sync would bring everything back.
  if (useCloud.getState().userId) await wipeCloud();
  await wipeAll();
  await initLock();
}
