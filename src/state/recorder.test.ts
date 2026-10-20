import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MicrophoneError } from '../audio';
import { capturesRepo } from '../db';
import { wipeAll } from '../db/maintenance';
import { createRecorderService } from './recorder';
import type { RecorderServiceDeps } from './recorder';
import type { Job, SettledEvent } from './processing';
import { FakeDictation, FakeRecorder } from './testing';

beforeEach(wipeAll);

interface Rig {
  recorder: FakeRecorder;
  dictation: FakeDictation | undefined;
  process: ReturnType<typeof vi.fn<(captureId: string) => void>>;
  vibrate: ReturnType<typeof vi.fn<(ms: number) => void>>;
  service: ReturnType<typeof createRecorderService>;
  deps: RecorderServiceDeps;
  /** The processing service reports a result for a capture. */
  settle(captureId: string, job: Partial<Job>): void;
}

function rig({
  dictation = true,
  recorder = new FakeRecorder('rec-1'),
  next = [],
}: { dictation?: boolean; recorder?: FakeRecorder; next?: FakeRecorder[] } = {}): Rig {
  const queue = [recorder, ...next];
  const speech = dictation ? new FakeDictation() : undefined;
  const process = vi.fn<(captureId: string) => void>();
  const vibrate = vi.fn<(ms: number) => void>();
  const listeners = new Set<(event: SettledEvent) => void>();
  const deps: RecorderServiceDeps = {
    createRecorder: () => (queue.length > 1 ? queue.shift()! : queue[0]!),
    createDictation: () => speech,
    loadSettings: async () => (await import('../db')).settingsRepo.getSettings(),
    process,
    jobs: {
      markSaving: vi.fn(),
      forget: vi.fn(),
      onSettled: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    vibrate,
    attachMediaSession: () => () => undefined,
  };
  const settle = (captureId: string, job: Partial<Job>): void => {
    const full: Job = { captureId, stage: 'done', mode: 'auto', startedAt: 0, ...job };
    for (const listener of listeners) listener({ captureId, job: full });
  };
  return { recorder, dictation: speech, process, vibrate, service: createRecorderService(deps), deps, settle };
}

describe('starting', () => {
  it('asks the microphone inside the tap: the recorder starts before the first await', () => {
    const { service, recorder } = rig();
    void service.start();
    // Synchronously, with no await in between: this is the user's gesture.
    expect(recorder.startCalls).toBe(1);
    expect(service.store.getState()).toMatchObject({ phase: 'recording', starting: true, captureId: 'rec-1' });
  });

  it('is recording once the microphone answered, and vibrates once', async () => {
    const { service, vibrate } = rig();
    expect(await service.start()).toBe(true);
    expect(service.store.getState()).toMatchObject({ phase: 'recording', starting: false });
    expect(vibrate).toHaveBeenCalledWith(8);
  });

  it('a second start while recording does nothing', async () => {
    const { service, recorder } = rig();
    await service.start();
    expect(await service.start()).toBe(false);
    expect(recorder.startCalls).toBe(1);
  });

  it('a refused microphone returns to idle with the reason, and leaves no capture behind', async () => {
    const recorder = new FakeRecorder('rec-denied');
    recorder.startError = new MicrophoneError('denied');
    const { service } = rig({ recorder });

    expect(await service.start()).toBe(false);

    const state = service.store.getState();
    expect(state.phase).toBe('idle');
    expect(state.micProblem).toMatchObject({ code: 'denied' });
    expect(state.micProblem?.message).toContain('Нет доступа к микрофону');
    expect(await capturesRepo.get('rec-denied')).toBeUndefined();
  });

  it('works without live dictation: the screen keeps the orb, the timer and the wave', async () => {
    const { service } = rig({ dictation: false });
    await service.start();
    expect(service.store.getState().dictation).toBe('unsupported');
  });

  it('follows the timer of the recorder', async () => {
    const { service, recorder } = rig();
    await service.start();
    recorder.tick(2_500);
    expect(service.store.getState().elapsedMs).toBe(2_500);
  });

  it('passes the microphone level through one stable source', async () => {
    const { service, recorder } = rig();
    const levels: number[] = [];
    const off = service.level.subscribe((level) => levels.push(level));
    await service.start();
    recorder.speak(0.6);
    off();
    expect(levels).toContain(0.6);
    expect(service.level.value).toBe(0.6);
  });
});

describe('pause and resume', () => {
  it('moves recording ⇄ paused and silences dictation while paused', async () => {
    const { service, dictation } = rig();
    await service.start();
    expect(dictation?.starts).toBe(1);

    service.pause();
    expect(service.store.getState().phase).toBe('paused');
    expect(dictation?.stops).toBe(1);

    service.resume();
    expect(service.store.getState().phase).toBe('recording');
    expect(dictation?.starts).toBe(2);
  });

  it('pause only works while recording', () => {
    const { service, recorder } = rig();
    service.pause();
    expect(service.store.getState().phase).toBe('idle');
    expect(recorder.state).toBe('idle');
  });
});

describe('«Готово»', () => {
  it('saves the dictated text at once and hands the capture to the processing, whatever the network does', async () => {
    const { service, recorder, dictation, process } = rig();
    await service.start();
    recorder.tick(12_000);
    dictation?.say('Решил поднять цену на тестовый урок');
    dictation?.hear('и написать Маше');

    const id = await service.done();

    expect(id).toBe('rec-1');
    const capture = await capturesRepo.get('rec-1');
    expect(capture).toMatchObject({
      status: 'transcribed',
      text: 'Решил поднять цену на тестовый урок и написать Маше',
      rawText: 'Решил поднять цену на тестовый урок и написать Маше',
      durationSec: 12,
    });
    expect(process).toHaveBeenCalledWith('rec-1');
    expect(service.store.getState()).toMatchObject({ phase: 'processing', captureId: 'rec-1' });
  });

  it('does not wait for the processing: it is only started', async () => {
    const { service, process } = rig();
    process.mockImplementation(() => new Promise<never>(() => undefined) as never);
    await service.start();
    await expect(service.done()).resolves.toBe('rec-1');
  });

  it('keeps a recording with no recognised text as a raw capture that waits for processing', async () => {
    const { service, process } = rig({ dictation: false });
    await service.start();
    await service.done();
    expect(await capturesRepo.get('rec-1')).toMatchObject({ status: 'raw', text: '' });
    expect(process).toHaveBeenCalledWith('rec-1');
  });

  it('uses the text the author edited instead of the dictated one', async () => {
    const { service, dictation } = rig();
    await service.start();
    dictation?.say('решил поднять цену на тестовый урок');

    await service.done({ text: '  Решил поднять цену на тестовый урок до 1500 ₽.  ' });

    expect(await capturesRepo.get('rec-1')).toMatchObject({
      text: 'Решил поднять цену на тестовый урок до 1500 ₽.',
      rawText: 'решил поднять цену на тестовый урок',
    });
  });

  it('an empty recording is dropped: nothing is processed', async () => {
    const recorder = new FakeRecorder('rec-empty');
    recorder.empty = true;
    const { service, process } = rig({ recorder });
    await service.start();

    expect(await service.done()).toBeNull();

    expect(process).not.toHaveBeenCalled();
    expect(service.store.getState().phase).toBe('idle');
  });

  it('does nothing when no recording runs', async () => {
    const { service, process } = rig();
    expect(await service.done()).toBeNull();
    expect(process).not.toHaveBeenCalled();
  });

  it('a recording the browser ended by itself is saved and processed as well', async () => {
    const { service, recorder, dictation, process } = rig();
    await service.start();
    dictation?.say('Микрофон отвалился на полуслове');
    recorder.tick(30_000);

    recorder.fire('error', Object.assign(new Error('Запись прервалась: микрофон отключился. Всё, что успело записаться, сохранено.'), { code: 'interrupted', fatal: true }) as never);
    recorder.fire('finish', {
      captureId: 'rec-1',
      audioId: 'a',
      mime: 'audio/webm',
      sizeBytes: 10,
      durationSec: 30,
      chunks: 3,
      interrupted: true,
    });
    await vi.waitFor(() => expect(process).toHaveBeenCalledWith('rec-1'));

    expect((await capturesRepo.get('rec-1'))?.text).toBe('Микрофон отвалился на полуслове');
    expect(service.store.getState().notice).toContain('Запись прервалась');
  });
});

describe('machine: processing → review → idle', () => {
  const found = { outcome: 'review' } as Job['result'];

  it('moves on to review when objects wait for the decision', async () => {
    const { service, settle } = rig();
    await service.start();
    await service.done();
    expect(service.store.getState().phase).toBe('processing');

    settle('rec-1', { stage: 'done', result: found });

    expect(service.store.getState().phase).toBe('review');
  });

  it('goes back to idle when nothing is left to decide, or when the capture can only wait', async () => {
    const first = rig();
    await first.service.start();
    await first.service.done();
    first.settle('rec-1', { stage: 'done', result: { outcome: 'done' } as Job['result'] });
    expect(first.service.store.getState().phase).toBe('idle');

    const second = rig({ recorder: new FakeRecorder('rec-2') });
    await second.service.start();
    await second.service.done();
    second.settle('rec-2', { stage: 'waiting', waiting: 'no-key' });
    expect(second.service.store.getState().phase).toBe('idle');
  });

  it('a result for another capture does not move the machine', async () => {
    const { service, settle } = rig();
    await service.start();
    await service.done();
    settle('somebody-else', { stage: 'done', result: found });
    expect(service.store.getState().phase).toBe('processing');
  });

  it('a new recording can start while the previous one is still being processed', async () => {
    const { service } = rig({ next: [new FakeRecorder('rec-next')] });
    await service.start();
    await service.done();
    expect(service.store.getState()).toMatchObject({ phase: 'processing', captureId: 'rec-1' });

    expect(await service.start()).toBe(true);

    expect(service.store.getState()).toMatchObject({ phase: 'recording', captureId: 'rec-next' });
  });

  it('dismissReview leaves processing/review for idle, but only for its own capture', async () => {
    const { service } = rig();
    await service.start();
    await service.done();

    service.dismissReview('another');
    expect(service.store.getState().phase).toBe('processing');
    service.dismissReview('rec-1');
    expect(service.store.getState().phase).toBe('idle');
  });
});

describe('✕', () => {
  it('a short recording is thrown away at once', async () => {
    const { service, recorder, process } = rig();
    await service.start();
    recorder.tick(3_000);

    expect(await service.cancel()).toEqual({ kind: 'discarded' });

    expect(recorder.cancelCalls).toBe(1);
    expect(process).not.toHaveBeenCalled();
    expect(service.store.getState().phase).toBe('idle');
    expect(await capturesRepo.get('rec-1')).toBeUndefined();
  });

  it('a recording over five seconds goes to the trash and "Вернуть" brings it back and processes it', async () => {
    const { service, recorder, dictation, process } = rig();
    await service.start();
    dictation?.say('Важная мысль на прогулке');
    recorder.tick(42_000);

    const outcome = await service.cancel();

    expect(outcome.kind).toBe('undoable');
    expect(service.store.getState().phase).toBe('idle');
    expect((await capturesRepo.get('rec-1'))?.deletedAt).toBeDefined();
    expect(process).not.toHaveBeenCalled();

    if (outcome.kind !== 'undoable') return;
    expect(await outcome.undo()).toBe('rec-1');
    const restored = await capturesRepo.get('rec-1');
    expect(restored?.deletedAt).toBeUndefined();
    expect(restored?.text).toBe('Важная мысль на прогулке');
    expect(process).toHaveBeenCalledWith('rec-1');
  });

  it('does nothing when nothing records', async () => {
    const { service } = rig();
    expect(await service.cancel()).toEqual({ kind: 'nothing' });
  });
});

describe('typed text', () => {
  it('is saved as a text capture right away and processed', async () => {
    const { service, process } = rig();

    const id = await service.saveText('  Надо позвонить маме Саши  ', { context: 'home' });

    expect(await capturesRepo.get(id)).toMatchObject({ kind: 'text', text: 'Надо позвонить маме Саши', status: 'transcribed', context: 'home' });
    expect(process).toHaveBeenCalledWith(id);
    expect(service.store.getState()).toMatchObject({ phase: 'processing', captureId: id });
  });

  it('refuses an empty text', async () => {
    const { service } = rig();
    await expect(service.saveText('   ')).rejects.toThrow(RangeError);
  });

  it('a note typed during a recording does not disturb the recording', async () => {
    const { service } = rig();
    await service.start();
    await service.saveText('Быстрая мысль');
    expect(service.store.getState()).toMatchObject({ phase: 'recording', captureId: 'rec-1' });
  });
});
