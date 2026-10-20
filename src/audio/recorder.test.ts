import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioRepo, capturesRepo, db } from '../db';
import { wipeAll } from '../db/maintenance';
import { MicrophoneError } from './permissions';
import { Recorder, RecorderError } from './recorder';
import type { RecorderEvents, RecordingResult } from './recorder';
import { createRecorderHarness } from './test-fakes';

beforeEach(wipeAll);
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

type Harness = ReturnType<typeof createRecorderHarness>;

async function startRecorder(harness: Harness, options: ConstructorParameters<typeof Recorder>[0] = {}) {
  const recorder = new Recorder({ deps: harness.deps, ...options });
  await recorder.start();
  return recorder;
}

/** Everything a recorder says, in order. */
function watch(recorder: Recorder) {
  const log = {
    states: [] as RecorderEvents['state'][],
    chunks: [] as number[],
    errors: [] as RecorderError[],
    ticks: [] as number[],
    finished: [] as RecordingResult[],
  };
  recorder.on('state', (state) => log.states.push(state));
  recorder.on('chunk', ({ seq }) => log.chunks.push(seq));
  recorder.on('error', (error) => log.errors.push(error));
  recorder.on('tick', ({ elapsedMs }) => log.ticks.push(elapsedMs));
  recorder.on('finish', (result) => log.finished.push(result));
  return log;
}

const storedChunks = async (captureId: string) => (await audioRepo.listChunks(captureId)).map((chunk) => chunk.seq);

describe('starting', () => {
  it('opens the microphone, creates the voice capture and starts MediaRecorder with a 10 s timeslice', async () => {
    const harness = createRecorderHarness();
    const recorder = new Recorder({ deps: harness.deps, context: 'walk' });
    const log = watch(recorder);
    expect(recorder.state).toBe('idle');

    await recorder.start();

    expect(log.states).toEqual(['starting', 'recording']);
    expect(harness.media?.timeslice).toBe(10_000);
    expect(harness.media?.options).toMatchObject({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32_000 });
    expect(recorder.mime).toBe('audio/webm;codecs=opus');
    expect(await capturesRepo.get(recorder.captureId)).toMatchObject({ kind: 'voice', status: 'raw', text: '', context: 'walk' });
    expect(harness.wakeLock.acquired).toBe(1);
  });

  it('records in the format the browser supports: Safari gets MP4, an unknown browser its own default', async () => {
    const safari = createRecorderHarness();
    safari.mimeType = 'audio/mp4';
    const mp4 = await startRecorder(safari);
    expect(mp4.mime).toBe('audio/mp4');
    expect(safari.media?.options.mimeType).toBe('audio/mp4');

    const unknown = createRecorderHarness();
    unknown.mimeType = undefined;
    const fallback = await startRecorder(unknown);
    expect(unknown.media?.options).not.toHaveProperty('mimeType');
    expect(fallback.mime).toBe('audio/webm');
  });

  it('uses the capture id it is given', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness, { captureId: 'my-capture' });
    expect(recorder.captureId).toBe('my-capture');
    expect(await capturesRepo.get('my-capture')).toBeDefined();
  });

  it('records once: a second start is refused', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    await expect(recorder.start()).rejects.toThrow('уже была начата');
  });

  it('leaves nothing behind when the microphone is refused, and says why in Russian', async () => {
    const harness = createRecorderHarness({ getUserMedia: () => Promise.reject(new MicrophoneError('denied')) });
    const recorder = new Recorder({ deps: harness.deps });
    const log = watch(recorder);

    await expect(recorder.start()).rejects.toMatchObject({ code: 'denied', message: expect.stringContaining('Нет доступа к микрофону') });

    expect(recorder.state).toBe('failed');
    expect(log.states).toEqual(['starting', 'failed']);
    expect(await capturesRepo.get(recorder.captureId)).toBeUndefined();
    expect(harness.media).toBeUndefined();
  });

  it('releases the microphone and reports a RecorderError when the capture cannot be stored', async () => {
    const harness = createRecorderHarness();
    vi.spyOn(db.captures, 'add').mockRejectedValueOnce(new Error('disk full'));
    const recorder = new Recorder({ deps: harness.deps });

    const error = await recorder.start().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RecorderError);
    expect(error).toMatchObject({ code: 'media', fatal: true });
    expect(recorder.state).toBe('failed');
    expect(harness.stream.track.stopped).toBe(true);
    expect(harness.wakeLock.released).toBe(1);
  });

  it('can be cancelled while the permission question is still open', async () => {
    let allow: () => void = () => {};
    const harness = createRecorderHarness();
    harness.deps.getUserMedia = () =>
      new Promise((resolve) => {
        allow = () => resolve(harness.stream.asMediaStream());
      });
    const recorder = new Recorder({ deps: harness.deps });

    const started = recorder.start();
    await recorder.cancel();
    allow();
    await started;

    expect(recorder.state).toBe('cancelled');
    expect(harness.stream.track.stopped).toBe(true);
    expect(harness.media).toBeUndefined();
    expect(await capturesRepo.get(recorder.captureId)).toBeUndefined();
  });
});

describe('chunks and the final recording', () => {
  it('writes each chunk to IndexedDB as it arrives and glues them in order on stop', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    const log = watch(recorder);
    const { captureId } = recorder;

    harness.clockMs = 10_000;
    harness.media!.deliver('aaa');
    await vi.waitFor(async () => expect(await storedChunks(captureId)).toEqual([0]));
    expect(log.chunks).toEqual([0]);
    // The length is kept current, so a crash still leaves a known duration.
    await vi.waitFor(async () => expect((await capturesRepo.get(captureId))?.durationSec).toBe(10));

    harness.clockMs = 20_000;
    harness.media!.deliver('bbb');
    await vi.waitFor(async () => expect(await storedChunks(captureId)).toEqual([0, 1]));
    expect((await capturesRepo.get(captureId))?.audioId).toBeUndefined();

    harness.clockMs = 25_000;
    harness.media!.capture('cc');
    const result = await recorder.stop();

    expect(result).toEqual({
      captureId,
      audioId: expect.any(String),
      mime: 'audio/webm;codecs=opus',
      sizeBytes: 8,
      durationSec: 25,
      chunks: 3,
      interrupted: false,
    });
    const audio = await audioRepo.getForCapture(captureId);
    expect(await audio?.data.text()).toBe('aaabbbcc');
    expect(audio).toMatchObject({ id: result?.audioId, mime: 'audio/webm;codecs=opus', chunks: 3 });
    expect(await storedChunks(captureId)).toEqual([]);
    expect(await capturesRepo.get(captureId)).toMatchObject({ audioId: result?.audioId, durationSec: 25, status: 'raw' });
    expect(log.states).toEqual(['stopping', 'finished']);
    expect(log.finished).toEqual([result]);
  });

  it('releases the microphone, the audio graph, the screen lock and the recording mark', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    harness.media!.deliver('a');
    await recorder.stop();

    expect(harness.stream.track.stopped).toBe(true);
    expect(harness.analyserClosed).toBe(true);
    expect(harness.wakeLock.released).toBe(1);
    expect(harness.scheduler.pending).toBe(0);
  });

  it('is idempotent: stopping twice gives the same result', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    harness.media!.deliver('a');
    const [first, second] = await Promise.all([recorder.stop(), recorder.stop()]);
    expect(second).toBe(first);
    expect(await recorder.stop()).toBe(first);
  });

  it('removes the empty capture and resolves null when nothing was recorded', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    const log = watch(recorder);

    expect(await recorder.stop()).toBeNull();

    expect(recorder.state).toBe('cancelled');
    expect(log.finished).toEqual([]);
    expect(await capturesRepo.get(recorder.captureId)).toBeUndefined();
  });

  it('does nothing when asked to stop before it started', async () => {
    const recorder = new Recorder({ deps: createRecorderHarness().deps });
    expect(await recorder.stop()).toBeNull();
    expect(recorder.state).toBe('idle');
  });

  it('keeps the chunks for recovery when sealing fails', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    const log = watch(recorder);
    harness.media!.deliver('aaa');
    await vi.waitFor(() => expect(log.chunks).toEqual([0]));
    vi.spyOn(db.audio, 'add').mockRejectedValueOnce(new Error('disk full'));

    await expect(recorder.stop()).rejects.toMatchObject({ code: 'storage', fatal: true });

    expect(recorder.state).toBe('failed');
    expect(log.errors).toHaveLength(1);
    expect(await storedChunks(recorder.captureId)).toEqual([0]);
  });
});

describe('a failing disk', () => {
  it('warns, keeps the chunk in memory and writes it again when the recording is sealed', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    const log = watch(recorder);
    vi.spyOn(db.chunks, 'put').mockRejectedValueOnce(new Error('QuotaExceededError'));

    harness.media!.deliver('aaa');
    await vi.waitFor(() => expect(log.errors).toHaveLength(1));
    expect(log.errors[0]).toMatchObject({ code: 'storage', fatal: false, message: expect.stringContaining('свободное место') });
    expect(recorder.state).toBe('recording');

    harness.media!.deliver('bbb');
    await vi.waitFor(() => expect(log.chunks).toEqual([1]));
    const result = await recorder.stop();

    expect(result).toMatchObject({ chunks: 2 });
    expect(await (await audioRepo.getForCapture(recorder.captureId))?.data.text()).toBe('aaabbb');
  });

  it('keeps recording when the capture was deleted meanwhile', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    const log = watch(recorder);
    await db.captures.delete(recorder.captureId);

    harness.media!.deliver('aaa');
    await vi.waitFor(() => expect(log.chunks).toEqual([0]));
    expect(log.errors).toEqual([]);
  });
});

describe('pause and resume', () => {
  it('stops the clock, saves what is buffered and carries on afterwards', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    const log = watch(recorder);

    harness.clockMs = 4_000;
    harness.media!.capture('xx');
    recorder.pause();

    expect(recorder.state).toBe('paused');
    expect(harness.media?.state).toBe('paused');
    expect(harness.media?.requestDataCalls).toBe(1);
    await vi.waitFor(async () => expect(await storedChunks(recorder.captureId)).toEqual([0]));

    harness.clockMs = 14_000;
    expect(recorder.elapsedMs).toBe(4_000);

    recorder.resume();
    expect(recorder.state).toBe('recording');
    expect(harness.media?.state).toBe('recording');
    harness.clockMs = 17_000;
    expect(recorder.elapsedMs).toBe(7_000);

    const result = await recorder.stop();
    expect(result?.durationSec).toBe(7);
    expect(log.states).toEqual(['paused', 'recording', 'stopping', 'finished']);
  });

  it('stops while paused', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    harness.clockMs = 3_000;
    harness.media!.capture('xx');
    recorder.pause();
    harness.clockMs = 60_000;

    const result = await recorder.stop();

    expect(result).toMatchObject({ durationSec: 3, interrupted: false });
    expect(await (await audioRepo.getForCapture(recorder.captureId))?.data.text()).toBe('xx');
  });

  it('ignores pause and resume in the wrong state', async () => {
    const harness = createRecorderHarness();
    const recorder = new Recorder({ deps: harness.deps });
    recorder.pause();
    recorder.resume();
    expect(recorder.state).toBe('idle');

    await recorder.start();
    recorder.resume();
    expect(harness.media?.state).toBe('recording');
    recorder.pause();
    recorder.pause();
    expect(harness.media?.requestDataCalls).toBe(1);
  });
});

describe('timer', () => {
  it('ticks every 250 ms while recording and reports the final time on pause and stop', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    const log = watch(recorder);

    harness.clockMs = 250;
    vi.advanceTimersByTime(250);
    harness.clockMs = 500;
    vi.advanceTimersByTime(250);
    expect(log.ticks).toEqual([250, 500]);

    harness.clockMs = 600;
    recorder.pause();
    expect(log.ticks).toEqual([250, 500, 600]);
    vi.advanceTimersByTime(2_000);
    expect(log.ticks).toEqual([250, 500, 600]);

    recorder.resume();
    harness.clockMs = 850;
    vi.advanceTimersByTime(250);
    expect(log.ticks.at(-1)).toBe(600 + 250);

    harness.media!.deliver('a');
    await recorder.stop();
    expect(log.ticks.at(-1)).toBe(850);
    const count = log.ticks.length;
    vi.advanceTimersByTime(2_000);
    expect(log.ticks).toHaveLength(count);
  });
});

describe('level', () => {
  it('follows the microphone as its own stream, silent when paused and after the end', async () => {
    const harness = createRecorderHarness();
    const recorder = new Recorder({ deps: harness.deps });
    expect(recorder.level.value).toBe(0);
    const levels: number[] = [];
    recorder.level.subscribe((level) => levels.push(level));
    await recorder.start();

    harness.analyser.setAmplitude(0.1);
    harness.scheduler.step(16);
    harness.scheduler.step(32);
    expect(recorder.level.value).toBeGreaterThan(0);
    expect(levels.length).toBeGreaterThan(0);

    recorder.pause();
    expect(recorder.level.value).toBe(0);
    expect(harness.scheduler.pending).toBe(0);

    recorder.resume();
    expect(harness.scheduler.pending).toBe(1);
    harness.scheduler.step(100);
    expect(recorder.level.value).toBeGreaterThan(0);

    harness.media!.deliver('a');
    await recorder.stop();
    expect(recorder.level.value).toBe(0);
    expect(harness.scheduler.pending).toBe(0);
  });

  it('records without a level where Web Audio is unavailable', async () => {
    const harness = createRecorderHarness({ createAnalyser: () => undefined });
    const recorder = await startRecorder(harness);
    harness.media!.deliver('a');
    expect(await recorder.stop()).not.toBeNull();
    expect(recorder.level.value).toBe(0);
  });
});

describe('interruptions', () => {
  it('saves what it has when the microphone disappears', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    const log = watch(recorder);
    harness.clockMs = 12_000;
    harness.media!.deliver('aaa');
    await vi.waitFor(() => expect(log.chunks).toEqual([0]));
    harness.clockMs = 15_000;
    harness.media!.capture('bb');

    harness.stream.track.end();
    await vi.waitFor(() => expect(log.finished).toHaveLength(1));

    expect(log.finished[0]).toMatchObject({ interrupted: true, durationSec: 15, chunks: 2 });
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]).toMatchObject({ code: 'interrupted', fatal: true, message: expect.stringContaining('микрофон отключился') });
    expect(recorder.state).toBe('finished');
    expect(await (await audioRepo.getForCapture(recorder.captureId))?.data.text()).toBe('aaabb');
    expect(harness.stream.track.stopped).toBe(true);
  });

  it('treats a stop nobody asked for as an interruption', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    const log = watch(recorder);
    harness.media!.capture('aaa');

    harness.media!.stop();
    await vi.waitFor(() => expect(log.finished).toHaveLength(1));

    expect(log.finished[0]?.interrupted).toBe(true);
    expect(log.errors.map((error) => error.code)).toEqual(['interrupted']);
  });

  it('reports a MediaRecorder error as a warning', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    const log = watch(recorder);
    harness.media!.fail();
    expect(log.errors).toMatchObject([{ code: 'media', fatal: false }]);
    expect(recorder.state).toBe('recording');
  });

  it('asks MediaRecorder for its buffered audio when the page goes to the background', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    harness.media!.capture('xx');

    harness.hidePage();

    expect(harness.media?.requestDataCalls).toBe(1);
    await vi.waitFor(async () => expect(await storedChunks(recorder.captureId)).toEqual([0]));

    recorder.pause();
    harness.hidePage();
    expect(harness.media?.requestDataCalls).toBe(2);
  });
});

describe('cancel', () => {
  it('throws the recording away: chunks, audio and the empty capture', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    const log = watch(recorder);
    harness.media!.deliver('aaa');
    await vi.waitFor(async () => expect(await storedChunks(recorder.captureId)).toEqual([0]));
    harness.media!.capture('bb');

    await recorder.cancel();

    expect(recorder.state).toBe('cancelled');
    expect(log.states).toEqual(['stopping', 'cancelled']);
    expect(await storedChunks(recorder.captureId)).toEqual([]);
    expect(await capturesRepo.get(recorder.captureId)).toBeUndefined();
    expect(await audioRepo.getForCapture(recorder.captureId)).toBeUndefined();
    expect(harness.stream.track.stopped).toBe(true);
    expect(harness.wakeLock.released).toBe(1);
    expect(log.finished).toEqual([]);
  });

  it('works while paused and does nothing afterwards', async () => {
    const harness = createRecorderHarness();
    const recorder = await startRecorder(harness);
    recorder.pause();
    await recorder.cancel();
    expect(recorder.state).toBe('cancelled');
    await expect(recorder.cancel()).resolves.toBeUndefined();
  });
});
