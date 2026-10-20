import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AbortedError, BadKeyError, NoKeyError, OfflineError } from '../ai';
import type { LlmProvider, ProcessResult, SttProvider } from '../ai';
import { audioRepo, capturesRepo, settingsRepo } from '../db';
import { wipeAll } from '../db/maintenance';
import { createProcessing } from './processing';
import type { ProcessingDeps } from './processing';

beforeEach(wipeAll);

const llm = { id: 'test-llm' } as unknown as LlmProvider;
const manualLlm = { id: 'manual' } as unknown as LlmProvider;
const stt = { id: 'test-stt' } as unknown as SttProvider;

function resultOf(outcome: ProcessResult['outcome'] = 'review'): ProcessResult {
  return { outcome } as ProcessResult;
}

function build(overrides: Partial<ProcessingDeps> = {}) {
  const run = vi.fn<ProcessingDeps['run']>(async () => resultOf());
  const deps: ProcessingDeps = {
    getSettings: () => settingsRepo.getSettings(),
    hasAudio: async (id) => (await audioRepo.getForCapture(id)) !== undefined,
    textOf: async (id) => (await capturesRepo.get(id))?.text,
    createLlm: (_settings, manual) => (manual ? manualLlm : llm),
    createStt: () => stt,
    canTranscribe: () => true,
    readiness: () => ({ ready: true }),
    run,
    now: () => 1_000,
    ...overrides,
  };
  return { service: createProcessing(deps), run, deps };
}

async function typed(text = 'Решил поднять цену') {
  return (await capturesRepo.create({ kind: 'text', text })).id;
}

describe('a capture that can be processed', () => {
  it('runs the pipeline with the providers of the settings and keeps the result', async () => {
    const { service, run } = build();
    const id = await typed();

    const job = await service.enqueue(id);

    expect(job).toMatchObject({ captureId: id, stage: 'done', mode: 'auto', result: { outcome: 'review' } });
    expect(run).toHaveBeenCalledWith(id, expect.objectContaining({ llm, stt }));
    expect(service.getJob(id)?.stage).toBe('done');
  });

  it('one run per capture: a second call while it works returns the same run', async () => {
    let release: (value: ProcessResult) => void = () => undefined;
    const run = vi.fn<ProcessingDeps['run']>(() => new Promise<ProcessResult>((resolve) => (release = resolve)));
    const { service } = build({ run });
    const id = await typed();

    const first = service.enqueue(id);
    const second = service.enqueue(id);
    await vi.waitFor(() => expect(service.getJob(id)?.stage).toBe('running'));
    release(resultOf());

    expect(await first).toBe(await second);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('tells listeners when a job settles', async () => {
    const { service } = build();
    const seen: string[] = [];
    service.onSettled(({ captureId, job }) => seen.push(`${captureId}:${job.stage}`));
    const id = await typed();
    await service.enqueue(id);
    expect(seen).toEqual([`${id}:done`]);
  });
});

describe('waiting instead of failing: the capture is saved, nothing is lost', () => {
  it('without a key the capture waits and the pipeline is not called', async () => {
    const { service, run } = build({ readiness: () => ({ ready: false, reason: 'Не задан ключ Anthropic.' }) });
    const id = await typed();

    const job = await service.enqueue(id);

    expect(job).toMatchObject({ stage: 'waiting', waiting: 'no-key', message: 'Не задан ключ Anthropic.' });
    expect(run).not.toHaveBeenCalled();
    expect((await capturesRepo.get(id))?.status).toBe('transcribed');
  });

  it('clipboard mode needs no key: the manual provider is used', async () => {
    const { service, run } = build({ readiness: () => ({ ready: false, reason: 'нет ключа' }) });
    const id = await typed();

    const job = await service.enqueue(id, { manual: true });

    expect(job).toMatchObject({ stage: 'done', mode: 'manual' });
    expect(run).toHaveBeenCalledWith(id, expect.objectContaining({ llm: manualLlm }));
  });

  it('the provider "через буфер обмена" in the settings is clipboard mode too', async () => {
    await settingsRepo.updateSettings({ ai: { provider: 'manual' } });
    const { service, run } = build({ readiness: () => ({ ready: false }) });
    const id = await typed();
    expect((await service.enqueue(id)).mode).toBe('manual');
    expect(run).toHaveBeenCalledWith(id, expect.objectContaining({ llm: manualLlm }));
  });

  it('a recording with no text that nobody can transcribe waits for typed text', async () => {
    const { service, run } = build({ canTranscribe: () => false });
    const capture = await capturesRepo.create({ kind: 'voice', text: '', status: 'raw' });
    await audioRepo.save(capture.id, new Blob(['x'], { type: 'audio/webm' }), { mime: 'audio/webm' });

    const job = await service.enqueue(capture.id);

    expect(job).toMatchObject({ stage: 'waiting', waiting: 'no-transcript' });
    expect(run).not.toHaveBeenCalled();
  });

  it('a recording that already has dictated text is processed even if the recogniser cannot read files', async () => {
    const { service, run } = build({ canTranscribe: () => false });
    const capture = await capturesRepo.create({ kind: 'voice', text: 'Продиктовал на ходу', status: 'transcribed' });
    await audioRepo.save(capture.id, new Blob(['x'], { type: 'audio/webm' }), { mime: 'audio/webm' });

    expect((await service.enqueue(capture.id)).stage).toBe('done');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('a key that disappears during the run (NoKeyError) is also just waiting', async () => {
    const { service } = build({ run: async () => Promise.reject(new NoKeyError()) });
    const job = await service.enqueue(await typed());
    expect(job).toMatchObject({ stage: 'waiting', waiting: 'no-key' });
  });

  it('no network: waits, and runs again when the network returns', async () => {
    const run = vi.fn<ProcessingDeps['run']>().mockRejectedValueOnce(new OfflineError()).mockResolvedValue(resultOf());
    const { service } = build({ run });
    const id = await typed();

    expect(await service.enqueue(id)).toMatchObject({ stage: 'waiting', waiting: 'offline', retryable: true });

    service.retryOffline();
    await vi.waitFor(() => expect(service.getJob(id)?.stage).toBe('done'));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('giving up on the clipboard step (abort) leaves the capture waiting', async () => {
    const { service } = build({ run: async () => Promise.reject(new AbortedError()) });
    expect(await service.enqueue(await typed(), { manual: true })).toMatchObject({ stage: 'waiting', waiting: 'cancelled', mode: 'manual' });
  });
});

describe('failures', () => {
  it('a rejected key is a failure with the provider message, ready for «Повторить»', async () => {
    const { service } = build({ run: async () => Promise.reject(new BadKeyError(401)) });
    const job = await service.enqueue(await typed());
    expect(job).toMatchObject({ stage: 'failed', errorCode: 'bad_key', retryable: true });
    expect(job.message).toContain('не принял ключ');
  });

  it('an unexpected error is described in Russian', async () => {
    const { service } = build({ run: async () => Promise.reject(new Error('boom')) });
    const job = await service.enqueue(await typed());
    expect(job).toMatchObject({ stage: 'failed', message: 'Не удалось обработать запись: boom' });
  });

  it('a retry starts clean: the old message is gone', async () => {
    const run = vi.fn<ProcessingDeps['run']>().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(resultOf());
    const { service } = build({ run });
    const id = await typed();
    await service.enqueue(id);
    const retried = await service.enqueue(id);
    expect(retried).toMatchObject({ stage: 'done' });
    expect(retried.message).toBeUndefined();
  });

  it('a capture that is gone fails with a plain sentence', async () => {
    const { service } = build();
    const job = await service.enqueue('missing');
    expect(job).toMatchObject({ stage: 'failed' });
    expect(job.message).toContain('не найдена');
  });
});

describe('bookkeeping', () => {
  it('markSaving shows the moment between «Готово» and the start of the pipeline', async () => {
    const { service } = build();
    service.markSaving('abc');
    expect(service.getJob('abc')).toMatchObject({ stage: 'saving' });
    service.forget('abc');
    expect(service.getJob('abc')).toBeUndefined();
  });
});
