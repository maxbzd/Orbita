import { describe, expect, it } from 'vitest';
import { RecordingLocks } from './locks';
import { FakeLockManager } from './test-fakes';

describe('RecordingLocks', () => {
  it('marks a recording as live in this tab and in others, until released', async () => {
    const manager = new FakeLockManager();
    const here = new RecordingLocks(manager);
    const otherTab = new RecordingLocks(manager);

    expect(await here.isHeld('a')).toBe(false);
    const release = await here.acquire('a');
    expect(await here.isHeld('a')).toBe(true);
    expect(await otherTab.isHeld('a')).toBe(true);
    expect(await otherTab.isHeld('b')).toBe(false);

    release();
    await Promise.resolve();
    expect(await here.isHeld('a')).toBe(false);
    expect(await otherTab.isHeld('a')).toBe(false);
  });

  it('frees the mark when the tab dies: the browser drops its locks', async () => {
    const manager = new FakeLockManager();
    await new RecordingLocks(manager).acquire('a');
    manager.held.clear();
    expect(await new RecordingLocks(manager).isHeld('a')).toBe(false);
  });

  it('does not probe a lock it holds itself into releasing it', async () => {
    const manager = new FakeLockManager();
    const locks = new RecordingLocks(manager);
    await locks.acquire('a');
    await locks.isHeld('a');
    await new RecordingLocks(manager).isHeld('a');
    expect(manager.held.has('orbita-recording:a')).toBe(true);
  });

  it('without Web Locks knows only its own recordings', async () => {
    const locks = new RecordingLocks(undefined);
    expect(await locks.isHeld('a')).toBeUndefined();
    const release = await locks.acquire('a');
    expect(await locks.isHeld('a')).toBe(true);
    release();
    expect(await locks.isHeld('a')).toBeUndefined();
  });

  it('treats a failing lock manager as no manager', async () => {
    const broken = { request: () => Promise.reject(new DOMException('opaque origin', 'SecurityError')) };
    const locks = new RecordingLocks(broken);
    const release = await locks.acquire('a');
    expect(await locks.isHeld('a')).toBe(true);
    release();
    expect(await locks.isHeld('a')).toBeUndefined();
  });
});
