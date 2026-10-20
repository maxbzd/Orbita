import { audioRepo, capturesRepo } from '../db';
import type { AudioBlob, Capture, ID } from '../domain/types';
import { DEFAULT_TIMESLICE_MS } from './recorder';
import { recordingLocks } from './locks';
import type { RecordingLocks } from './locks';
import { t } from '../i18n';

/**
 * A recording whose chunks are in IndexedDB but were never glued together: the tab was killed,
 * the phone died or the browser crashed. Shown at app start as "Найдена незавершённая запись".
 */
export interface RecoverableRecording extends audioRepo.UnfinishedRecording {
  /** The Capture the recorder created at start; missing if it was deleted since. */
  capture?: Capture;
  /** What the recording has: the length kept up to date during recording, or a guess from the chunk count. */
  durationSec: number;
}

export interface RecoveredRecording {
  capture: Capture;
  audio: AudioBlob;
}

export interface RecoveryOptions {
  locks?: Pick<RecordingLocks, 'isHeld'>;
  /** Without Web Locks a recording whose last chunk is younger than this may still be running in another tab. */
  liveWindowMs?: number;
  now?: number;
}

const DEFAULT_LIVE_WINDOW_MS = 3 * DEFAULT_TIMESLICE_MS;

export class RecordingInProgressError extends Error {
  constructor() {
    super(t('This recording is still going in another tab. Stop it there.'));
    this.name = 'RecordingInProgressError';
  }
}

/** True unless the recording belongs to a recorder that is alive right now. */
async function isAbandoned(
  recording: Pick<audioRepo.UnfinishedRecording, 'captureId' | 'lastChunkAt'>,
  { locks = recordingLocks, liveWindowMs = DEFAULT_LIVE_WINDOW_MS, now = Date.now() }: RecoveryOptions,
): Promise<boolean> {
  const held = await locks.isHeld(recording.captureId);
  if (held !== undefined) return !held;
  // Nothing tells us who owns the chunks: only a quiet period proves the recorder is gone.
  return now - Date.parse(recording.lastChunkAt) >= liveWindowMs;
}

/** Recordings left behind by a crash, oldest first. Recordings in progress (here or in another tab) are not included. */
export async function findUnfinishedRecordings(options: RecoveryOptions = {}): Promise<RecoverableRecording[]> {
  const found: RecoverableRecording[] = [];
  for (const recording of await audioRepo.listUnfinished()) {
    if (!(await isAbandoned(recording, options))) continue;
    const capture = await capturesRepo.get(recording.captureId);
    found.push({
      ...recording,
      ...(capture && { capture }),
      // Each chunk holds `timeslice` seconds of speech, except the last one that never got written.
      durationSec: capture?.durationSec ?? (recording.chunkCount * DEFAULT_TIMESLICE_MS) / 1000,
    });
  }
  return found;
}

/**
 * Glues the chunks of a crashed recording into audio and links it to its Capture, creating the
 * Capture if it is gone. Resolves undefined if there were no chunks. The result is a normal
 * `raw` voice capture, ready for transcription.
 */
export async function recoverRecording(captureId: ID, options: RecoveryOptions = {}): Promise<RecoveredRecording | undefined> {
  const chunks = await audioRepo.listChunks(captureId);
  const first = chunks[0];
  if (!first) return undefined;
  if (!(await isAbandoned({ captureId, lastChunkAt: chunks[chunks.length - 1]!.createdAt }, options))) {
    throw new RecordingInProgressError();
  }

  const existing = await capturesRepo.get(captureId);
  const durationSec = existing?.durationSec ?? (chunks.length * DEFAULT_TIMESLICE_MS) / 1000;
  if (!existing) {
    await capturesRepo.create({
      id: captureId,
      kind: 'voice',
      text: '',
      status: 'raw',
      createdAt: first.createdAt,
      durationSec,
    });
  }
  const audio = await audioRepo.finalizeFromChunks(captureId);
  if (!audio) return undefined;
  const capture = await capturesRepo.update(captureId, { durationSec });
  return { capture, audio };
}

export interface RecoveryReport {
  recovered: RecoveredRecording[];
  /** Recordings that could not be restored; their chunks are kept for the next attempt. */
  failed: { captureId: ID; error: unknown }[];
}

/** Restores every abandoned recording; one failure does not stop the others. */
export async function recoverAllRecordings(options: RecoveryOptions = {}): Promise<RecoveryReport> {
  const report: RecoveryReport = { recovered: [], failed: [] };
  for (const { captureId } of await findUnfinishedRecordings(options)) {
    try {
      const recovered = await recoverRecording(captureId, options);
      if (recovered) report.recovered.push(recovered);
    } catch (error) {
      report.failed.push({ captureId, error });
    }
  }
  return report;
}

/** The user does not want it back: deletes the chunks, and the Capture too if it is only the empty shell the recorder made. */
export async function discardRecording(captureId: ID, options: RecoveryOptions = {}): Promise<void> {
  const chunks = await audioRepo.listChunks(captureId);
  const last = chunks[chunks.length - 1];
  if (last && !(await isAbandoned({ captureId, lastChunkAt: last.createdAt }, options))) {
    throw new RecordingInProgressError();
  }
  await audioRepo.discardChunks(captureId);
  const capture = await capturesRepo.get(captureId);
  const isEmptyShell =
    capture !== undefined && capture.kind === 'voice' && capture.status === 'raw' && capture.text === '' && capture.audioId === undefined;
  if (isEmptyShell) await capturesRepo.destroy(captureId);
}
