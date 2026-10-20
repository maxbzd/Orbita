import { nowISO } from '../../domain/dates';
import { newId } from '../../domain/ids';
import type { AudioBlob, AudioChunk, ID, ISODate } from '../../domain/types';
import { patchRecord } from '../internal';
import { db } from '../schema';

const FALLBACK_MIME = 'audio/webm';

export interface NewChunk {
  captureId: ID;
  /** 0-based order within the recording. */
  seq: number;
  data: Blob;
  mime?: string;
}

/** A recording whose chunks were written but never assembled: the tab died or the app was closed. */
export interface UnfinishedRecording {
  captureId: ID;
  chunkCount: number;
  sizeBytes: number;
  mime: string;
  startedAt: ISODate;
  lastChunkAt: ISODate;
}

/** Stores the finished recording of a capture (replacing a previous one) and links it via `Capture.audioId`. */
export async function save(
  captureId: ID,
  data: Blob,
  { mime, chunks }: { mime?: string; chunks?: number } = {},
): Promise<AudioBlob> {
  return db.transaction('rw', db.audio, db.captures, async () => {
    await db.audio.where('captureId').equals(captureId).delete();
    const audio: AudioBlob = {
      id: newId(),
      captureId,
      mime: mime ?? (data.type || FALLBACK_MIME),
      sizeBytes: data.size,
      data,
      ...(chunks !== undefined && { chunks }),
      createdAt: nowISO(),
    };
    await db.audio.add(audio);
    if (await db.captures.get(captureId)) await patchRecord('captures', captureId, { audioId: audio.id });
    return audio;
  });
}

export async function get(id: ID): Promise<AudioBlob | undefined> {
  return db.audio.get(id);
}

export async function getForCapture(captureId: ID): Promise<AudioBlob | undefined> {
  return db.audio.where('captureId').equals(captureId).first();
}

/** Deletes the recording of a capture (the text stays). */
export async function remove(captureId: ID): Promise<void> {
  await db.transaction('rw', db.audio, db.captures, async () => {
    await db.audio.where('captureId').equals(captureId).delete();
    const capture = await db.captures.get(captureId);
    if (capture?.audioId) await patchRecord('captures', captureId, { audioId: undefined });
  });
}

// ───────── Crash-safe recording ─────────

const chunkId = (captureId: ID, seq: number): ID => `${captureId}#${seq}`;

/** Writes one MediaRecorder chunk right away. Writing the same `seq` again overwrites it. */
export async function appendChunk({ captureId, seq, data, mime }: NewChunk): Promise<AudioChunk> {
  const chunk: AudioChunk = {
    id: chunkId(captureId, seq),
    captureId,
    seq,
    mime: mime ?? (data.type || FALLBACK_MIME),
    data,
    createdAt: nowISO(),
  };
  await db.chunks.put(chunk);
  return chunk;
}

export async function listChunks(captureId: ID): Promise<AudioChunk[]> {
  const chunks = await db.chunks.where('captureId').equals(captureId).toArray();
  return chunks.sort((a, b) => a.seq - b.seq);
}

/** Joins the chunks of a recording into one audio row and drops the chunks. Undefined without chunks. */
export async function finalizeFromChunks(captureId: ID, { mime }: { mime?: string } = {}): Promise<AudioBlob | undefined> {
  return db.transaction('rw', db.audio, db.chunks, db.captures, async () => {
    const chunks = await listChunks(captureId);
    const first = chunks[0];
    if (!first) return undefined;
    const type = mime ?? first.mime;
    const audio = await save(captureId, new Blob(chunks.map((chunk) => chunk.data), { type }), {
      mime: type,
      chunks: chunks.length,
    });
    await db.chunks.where('captureId').equals(captureId).delete();
    return audio;
  });
}

export async function discardChunks(captureId: ID): Promise<void> {
  await db.chunks.where('captureId').equals(captureId).delete();
}

/** Recordings that left chunks behind, oldest first: offer to restore them at app start. */
export async function listUnfinished(): Promise<UnfinishedRecording[]> {
  const byCapture = new Map<ID, UnfinishedRecording>();
  await db.chunks.each((chunk) => {
    const existing = byCapture.get(chunk.captureId);
    if (!existing) {
      byCapture.set(chunk.captureId, {
        captureId: chunk.captureId,
        chunkCount: 1,
        sizeBytes: chunk.data.size,
        mime: chunk.mime,
        startedAt: chunk.createdAt,
        lastChunkAt: chunk.createdAt,
      });
      return;
    }
    existing.chunkCount += 1;
    existing.sizeBytes += chunk.data.size;
    if (chunk.createdAt < existing.startedAt) existing.startedAt = chunk.createdAt;
    if (chunk.createdAt > existing.lastChunkAt) existing.lastChunkAt = chunk.createdAt;
  });
  return [...byCapture.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}
