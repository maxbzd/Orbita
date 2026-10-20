import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioRepo, capturesRepo, db } from '../db';
import { wipeAll } from '../db/maintenance';
import { RecordingLocks } from './locks';
import { Recorder } from './recorder';
import {
  RecordingInProgressError,
  discardRecording,
  findUnfinishedRecordings,
  recoverAllRecordings,
  recoverRecording,
} from './recovery';
import { FakeLockManager, createRecorderHarness } from './test-fakes';

beforeEach(wipeAll);
afterEach(() => vi.restoreAllMocks());

/** Nobody is recording anything. */
const quiet = new RecordingLocks(new FakeLockManager());

const chunk = (captureId: string, seq: number, text: string) => audioRepo.appendChunk({ captureId, seq, data: new Blob([text], { type: 'audio/webm' }), mime: 'audio/webm' });

describe('findUnfinishedRecordings', () => {
  it('is empty when every recording was finished', async () => {
    expect(await findUnfinishedRecordings({ locks: quiet })).toEqual([]);
    const capture = await capturesRepo.create({ kind: 'voice', status: 'raw' });
    await chunk(capture.id, 0, 'a');
    await audioRepo.finalizeFromChunks(capture.id);
    expect(await findUnfinishedRecordings({ locks: quiet })).toEqual([]);
  });

  it('lists what a crash left behind with its capture and length', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', status: 'raw', durationSec: 42 });
    await chunk(capture.id, 0, 'aaa');
    await chunk(capture.id, 1, 'bb');

    const [found, ...rest] = await findUnfinishedRecordings({ locks: quiet });

    expect(rest).toEqual([]);
    expect(found).toMatchObject({ captureId: capture.id, chunkCount: 2, sizeBytes: 5, durationSec: 42 });
    expect(found?.capture?.id).toBe(capture.id);
  });

  it('estimates the length from the chunks when the capture does not know it, and lists orphans without a capture', async () => {
    await chunk('orphan', 0, 'a');
    await chunk('orphan', 1, 'b');
    await chunk('orphan', 2, 'c');
    const [found] = await findUnfinishedRecordings({ locks: quiet });
    expect(found).toMatchObject({ captureId: 'orphan', durationSec: 30 });
    expect(found?.capture).toBeUndefined();
  });

  it('does not offer a recording that is being made right now, here or in another tab', async () => {
    const manager = new FakeLockManager();
    const harness = createRecorderHarness({ locks: new RecordingLocks(manager) });
    const recorder = new Recorder({ deps: harness.deps });
    await recorder.start();
    harness.media!.deliver('aaa');
    await vi.waitFor(async () => expect(await audioRepo.listChunks(recorder.captureId)).toHaveLength(1));

    expect(await findUnfinishedRecordings({ locks: new RecordingLocks(manager) })).toEqual([]);
    await expect(recoverRecording(recorder.captureId, { locks: new RecordingLocks(manager) })).rejects.toBeInstanceOf(RecordingInProgressError);
    await expect(discardRecording(recorder.captureId, { locks: new RecordingLocks(manager) })).rejects.toThrow('ещё идёт');
    expect(await audioRepo.listChunks(recorder.captureId)).toHaveLength(1);

    await recorder.cancel();
  });

  it('without Web Locks waits until the last chunk is old enough to be sure', async () => {
    const blind = new RecordingLocks(undefined);
    await chunk('maybe-live', 0, 'a');
    const now = Date.now();

    expect(await findUnfinishedRecordings({ locks: blind, now })).toEqual([]);
    expect(await findUnfinishedRecordings({ locks: blind, now: now + 29_000 })).toEqual([]);
    expect(await findUnfinishedRecordings({ locks: blind, now: now + 31_000 })).toHaveLength(1);
    expect(await findUnfinishedRecordings({ locks: blind, now, liveWindowMs: 0 })).toHaveLength(1);
  });

  it('lists the oldest first', async () => {
    await chunk('newer', 0, 'a');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await chunk('older-id-but-later', 0, 'a');
    expect((await findUnfinishedRecordings({ locks: quiet })).map((found) => found.captureId)).toEqual(['newer', 'older-id-but-later']);
  });
});

describe('recoverRecording', () => {
  it('turns the chunks into audio on the capture the recorder created', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', status: 'raw', durationSec: 20 });
    await chunk(capture.id, 1, 'second');
    await chunk(capture.id, 0, 'first-');

    const recovered = await recoverRecording(capture.id, { locks: quiet });

    expect(await recovered?.audio.data.text()).toBe('first-second');
    expect(recovered?.audio).toMatchObject({ captureId: capture.id, chunks: 2, mime: 'audio/webm' });
    expect(recovered?.capture).toMatchObject({ id: capture.id, audioId: recovered?.audio.id, durationSec: 20, status: 'raw', kind: 'voice' });
    expect(await audioRepo.listChunks(capture.id)).toEqual([]);
    expect(await findUnfinishedRecordings({ locks: quiet })).toEqual([]);
  });

  it('creates the capture when it is gone, dated from the first chunk, with an estimated length', async () => {
    await chunk('lost', 0, 'a');
    await chunk('lost', 1, 'b');

    const recovered = await recoverRecording('lost', { locks: quiet });

    expect(recovered?.capture).toMatchObject({ id: 'lost', kind: 'voice', status: 'raw', text: '', durationSec: 20, audioId: recovered?.audio.id });
    expect(await capturesRepo.get('lost')).toBeDefined();
  });

  it('gives undefined when there is nothing to recover', async () => {
    expect(await recoverRecording('nothing', { locks: quiet })).toBeUndefined();
    expect(await capturesRepo.get('nothing')).toBeUndefined();
  });

  it('recovers the recording of a crashed recorder end to end', async () => {
    const manager = new FakeLockManager();
    const harness = createRecorderHarness({ locks: new RecordingLocks(manager) });
    const recorder = new Recorder({ deps: harness.deps });
    await recorder.start();
    harness.clockMs = 10_000;
    harness.media!.deliver('part1-');
    await vi.waitFor(async () => expect(await audioRepo.listChunks(recorder.captureId)).toHaveLength(1));
    harness.clockMs = 20_000;
    harness.media!.deliver('part2-');
    await vi.waitFor(async () => expect(await audioRepo.listChunks(recorder.captureId)).toHaveLength(2));
    harness.media!.capture('lost-with-the-tab');

    // The tab dies: the browser drops its locks and nothing is ever finalized. The app starts again.
    manager.held.clear();
    const afterRestart = new RecordingLocks(manager);

    const [found] = await findUnfinishedRecordings({ locks: afterRestart });
    expect(found).toMatchObject({ captureId: recorder.captureId, chunkCount: 2, durationSec: 20 });
    const recovered = await recoverRecording(recorder.captureId, { locks: afterRestart });

    expect(await recovered?.audio.data.text()).toBe('part1-part2-');
    expect(recovered?.capture).toMatchObject({ audioId: recovered?.audio.id, durationSec: 20, status: 'raw' });
    expect(await findUnfinishedRecordings({ locks: afterRestart })).toEqual([]);
  });
});

describe('recoverAllRecordings', () => {
  it('restores everything it can and reports what it could not', async () => {
    await chunk('good', 0, 'a');
    await chunk('bad', 0, 'b');
    await chunk('also-good', 0, 'c');
    const add = db.audio.add.bind(db.audio);
    vi.spyOn(db.audio, 'add').mockImplementation((audio) =>
      audio.captureId === 'bad' ? Dexie.Promise.reject(new Error('disk full')) : add(audio),
    );

    const report = await recoverAllRecordings({ locks: quiet });

    expect(report.recovered.map((recovered) => recovered.capture.id).sort()).toEqual(['also-good', 'good']);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.captureId).toBe('bad');
    expect(await audioRepo.listChunks('bad')).toHaveLength(1);
  });
});

describe('discardRecording', () => {
  it('deletes the chunks and the empty capture the recorder made', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', status: 'raw' });
    await chunk(capture.id, 0, 'a');

    await discardRecording(capture.id, { locks: quiet });

    expect(await audioRepo.listChunks(capture.id)).toEqual([]);
    expect(await capturesRepo.get(capture.id)).toBeUndefined();
  });

  it('keeps a capture that has text of its own', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', text: 'уже набрано руками' });
    await chunk(capture.id, 0, 'a');

    await discardRecording(capture.id, { locks: quiet });

    expect(await audioRepo.listChunks(capture.id)).toEqual([]);
    expect(await capturesRepo.get(capture.id)).toBeDefined();
  });

  it('is fine with chunks that have no capture', async () => {
    await chunk('orphan', 0, 'a');
    await discardRecording('orphan', { locks: quiet });
    expect(await audioRepo.listChunks('orphan')).toEqual([]);
  });
});
