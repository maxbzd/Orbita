import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { WALK_IDLE_MS, createIdleWatcher, useWalkMode } from './walkMode';

afterEach(() => vi.useRealTimers());

describe('the idle countdown', () => {
  it('goes dark after 20 seconds without a touch', () => {
    vi.useFakeTimers();
    const changes: boolean[] = [];
    createIdleWatcher({ onChange: (walking) => changes.push(walking) });

    vi.advanceTimersByTime(WALK_IDLE_MS - 1);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(changes).toEqual([true]);
  });

  it('a touch restarts the countdown, and a touch in the dark wakes the screen', () => {
    vi.useFakeTimers();
    const changes: boolean[] = [];
    const watcher = createIdleWatcher({ onChange: (walking) => changes.push(walking) });

    vi.advanceTimersByTime(15_000);
    watcher.poke();
    vi.advanceTimersByTime(15_000);
    expect(changes).toEqual([]);

    vi.advanceTimersByTime(5_000);
    expect(changes).toEqual([true]);
    expect(watcher.walking).toBe(true);

    watcher.poke();
    expect(changes).toEqual([true, false]);
    expect(watcher.walking).toBe(false);
  });

  it('stops for good when the recording ends', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const watcher = createIdleWatcher({ onChange });
    watcher.stop();
    vi.advanceTimersByTime(WALK_IDLE_MS * 2);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('useWalkMode', () => {
  it('follows the touches of the page while enabled', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWalkMode(true));
    expect(result.current.walking).toBe(false);

    act(() => void vi.advanceTimersByTime(WALK_IDLE_MS));
    expect(result.current.walking).toBe(true);

    act(() => void window.dispatchEvent(new Event('pointerdown')));
    expect(result.current.walking).toBe(false);
  });

  it('never goes dark while disabled (paused, idle)', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWalkMode(false));
    act(() => void vi.advanceTimersByTime(WALK_IDLE_MS * 3));
    expect(result.current.walking).toBe(false);
  });
});
