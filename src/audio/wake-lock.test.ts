import { describe, expect, it } from 'vitest';
import { FakePage, FakeWakeLockApi } from './test-fakes';
import { ScreenWakeLock } from './wake-lock';

describe('ScreenWakeLock', () => {
  it('takes the lock and releases it', async () => {
    const api = new FakeWakeLockApi();
    const lock = new ScreenWakeLock(api, new FakePage());
    expect(await lock.acquire()).toBe(true);
    expect(await lock.acquire()).toBe(true);
    expect(api.requests).toBe(1);

    await lock.release();
    expect(api.sentinels.map((sentinel) => sentinel.released)).toEqual([true]);
  });

  it('takes the lock again when the page comes back, since browsers drop it in the background', async () => {
    const api = new FakeWakeLockApi();
    const page = new FakePage();
    const lock = new ScreenWakeLock(api, page);
    await lock.acquire();

    page.hide();
    expect(api.requests).toBe(1);
    page.show();
    await Promise.resolve();
    await Promise.resolve();
    expect(api.requests).toBe(2);

    await lock.release();
    page.hide();
    page.show();
    await Promise.resolve();
    expect(api.requests).toBe(2);
  });

  it('does not keep a lock that was released while the request was in flight', async () => {
    const api = new FakeWakeLockApi();
    const lock = new ScreenWakeLock(api, new FakePage());
    const pending = lock.acquire();
    await lock.release();
    expect(await pending).toBe(false);
    expect(api.sentinels.every((sentinel) => sentinel.released)).toBe(true);
  });

  it('carries on without a lock where the API is missing or refuses', async () => {
    expect(await new ScreenWakeLock(undefined, new FakePage()).acquire()).toBe(false);

    const api = new FakeWakeLockApi();
    api.refuse = true;
    const lock = new ScreenWakeLock(api, new FakePage());
    expect(await lock.acquire()).toBe(false);
    await expect(lock.release()).resolves.toBeUndefined();
  });
});
