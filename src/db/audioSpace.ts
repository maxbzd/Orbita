import { remove } from './repos/audio';
import { db } from './schema';
import type { ID } from '../domain/types';

/**
 * Recordings are what fills a voice journal's storage; the words they hold are already saved as text. When the device runs
 * out of room, the least costly thing to give up is the sound of old, finished records: the text, the objects found in it and
 * everything linked stay. Only recordings of records that are done, have text, and are older than `days` are offered.
 */

export interface ReclaimableAudio {
  captureIds: ID[];
  bytes: number;
}

const DAY = 86_400_000;

export async function findOldRecordings(days = 30, now = Date.now()): Promise<ReclaimableAudio> {
  const before = now - days * DAY;
  const audio = await db.audio.toArray();
  const ids: ID[] = [];
  let bytes = 0;
  for (const recording of audio) {
    const capture = await db.captures.get(recording.captureId);
    if (!capture || capture.deletedAt || capture.status !== 'done' || capture.text.trim() === '') continue;
    if (Date.parse(capture.createdAt) > before) continue;
    ids.push(recording.captureId);
    bytes += recording.sizeBytes;
  }
  return { captureIds: ids, bytes };
}

/** Deletes the recordings (the texts stay). Returns how many were removed. */
export async function deleteRecordings(captureIds: readonly ID[]): Promise<number> {
  let removed = 0;
  for (const id of captureIds) {
    await remove(id);
    removed += 1;
  }
  return removed;
}
