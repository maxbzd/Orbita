import { describe, expect, it, vi } from 'vitest';
import type { RecoverableRecording } from '../audio';
import { createRecoveryService } from './recovery';
import type { RecoveryDeps } from './recovery';
import { processing } from './processing';

const lost = (captureId: string): RecoverableRecording =>
  ({ captureId, chunkCount: 3, sizeBytes: 3000, mime: 'audio/webm', lastChunkAt: '2026-10-08T10:00:00.000Z', durationSec: 30 }) as RecoverableRecording;

function build(overrides: Partial<RecoveryDeps> = {}) {
  const process = vi.fn<(id: string) => void>();
  const deps: RecoveryDeps = {
    find: async () => [lost('a'), lost('b')],
    recover: async (captureId) => ({ captureId }),
    discard: async () => undefined,
    process,
    ...overrides,
  };
  return { service: createRecoveryService(deps), process, deps };
}

describe('recovery of lost recordings', () => {
  it('looks once per launch and offers what it found', async () => {
    const find = vi.fn(async () => [lost('a')]);
    const { service } = build({ find });
    expect(await service.check()).toHaveLength(1);
    await service.check();
    expect(find).toHaveBeenCalledTimes(1);
    expect(service.store.getState()).toMatchObject({ checked: true });
    await service.check({ force: true });
    expect(find).toHaveBeenCalledTimes(2);
  });

  it('a failed search is the same as nothing to restore', async () => {
    const { service } = build({ find: async () => Promise.reject(new Error('db closed')) });
    expect(await service.check()).toEqual([]);
    expect(service.store.getState().checked).toBe(true);
  });

  it('«Восстановить» glues the recording back, removes the offer and starts the processing', async () => {
    const { service, process } = build();
    await service.check();

    expect(await service.restore('a')).toBe('a');

    expect(service.store.getState().items.map((item) => item.captureId)).toEqual(['b']);
    expect(process).toHaveBeenCalledWith('a');
    expect(processing.getJob('a')?.stage).toBe('saving');
  });

  it('a recording that cannot be restored stays on offer, with a message', async () => {
    const { service, process } = build({ recover: async () => Promise.reject(new Error('quota')) });
    await service.check();

    expect(await service.restore('a')).toBeUndefined();

    expect(service.store.getState().items).toHaveLength(2);
    expect(service.store.getState().error).toContain('Не удалось восстановить');
    expect(process).not.toHaveBeenCalled();
  });

  it('a recording with no audio chunks left is just removed from the offer', async () => {
    const { service, process } = build({ recover: async () => undefined });
    await service.check();
    expect(await service.restore('a')).toBeUndefined();
    expect(service.store.getState().items.map((item) => item.captureId)).toEqual(['b']);
    expect(process).not.toHaveBeenCalled();
  });

  it('«Удалить» discards the chunks', async () => {
    const discard = vi.fn(async () => undefined);
    const { service } = build({ discard });
    await service.check();
    await service.discard('b');
    expect(discard).toHaveBeenCalledWith('b');
    expect(service.store.getState().items.map((item) => item.captureId)).toEqual(['a']);
  });

  it('«Не сейчас» hides the offer for this launch and keeps the chunks', async () => {
    const discard = vi.fn(async () => undefined);
    const { service } = build({ discard });
    await service.check();
    service.postpone();
    expect(service.store.getState().items).toEqual([]);
    expect(discard).not.toHaveBeenCalled();
  });
});
