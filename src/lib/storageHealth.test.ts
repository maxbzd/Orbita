import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { peopleRepo, wipeAll } from '../db';
import { isQuotaError, resolveFull, storageLevel, useStorageHealth } from './storageHealth';

beforeEach(async () => {
  await wipeAll();
  resolveFull();
  useStorageHealth.setState({ usage: null, quota: null, failedAt: null });
});
afterEach(() => vi.restoreAllMocks());

describe('recognising a full storage', () => {
  it('knows the names the browsers use, and the error Dexie wraps around them', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaError({ name: 'UnknownError', code: 22 })).toBe(true);
    expect(isQuotaError({ name: 'AbortError', message: 'Transaction aborted', inner: { name: 'QuotaExceededError' } })).toBe(true);
    expect(isQuotaError(new Error('The quota has been exceeded'))).toBe(true);
  });

  it('does not cry wolf for other failures', () => {
    expect(isQuotaError(new Error('network down'))).toBe(false);
    expect(isQuotaError(new DOMException('bad key', 'DataError'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError('quota')).toBe(false);
  });
});

describe('a write the browser refuses', () => {
  it('is announced, still thrown to the caller, and leaves what was saved before untouched', async () => {
    const before = await peopleRepo.create({ name: 'Ольга', role: 'client' });
    const refuse = (): never => {
      throw new DOMException('no room', 'QuotaExceededError');
    };
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(refuse);
    const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(refuse);

    await expect(peopleRepo.create({ name: 'Игорь', role: 'client' })).rejects.toBeDefined();
    expect(useStorageHealth.getState().full).toBe(true);
    expect(storageLevel(useStorageHealth.getState())).toBe('full');
    put.mockRestore();
    add.mockRestore();
    expect((await peopleRepo.list()).map((p) => p.name)).toEqual(['Ольга']);
    expect((await peopleRepo.get(before.id))?.name).toBe('Ольга');
  });

  it('clears the notice by itself once writes work again', async () => {
    useStorageHealth.setState({ full: true });
    await peopleRepo.create({ name: 'Мария', role: 'client' });
    expect(useStorageHealth.getState().full).toBe(false);
  });
});

describe('the early warning', () => {
  const level = (usage: number | null, quota: number | null) => storageLevel({ full: false, usage, quota });
  it('stays quiet while there is room, or when the browser does not say', () => {
    expect(level(10 * 2 ** 20, 10 * 2 ** 30)).toBe('ok');
    expect(level(null, null)).toBe('ok');
    expect(level(5, 0)).toBe('ok');
  });
  it('speaks from 90 percent, or when under 25 MB are left', () => {
    expect(level(9.1 * 2 ** 30, 10 * 2 ** 30)).toBe('almost');
    expect(level(480 * 2 ** 20, 500 * 2 ** 20)).toBe('almost');
    expect(level(8 * 2 ** 30, 10 * 2 ** 30)).toBe('ok');
  });
});
