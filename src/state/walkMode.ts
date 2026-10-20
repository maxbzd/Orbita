import { useCallback, useEffect, useRef, useState } from 'react';

/** "Режим прогулки": this long without a touch and the screen goes dark. */
export const WALK_IDLE_MS = 20_000;

/** Events that count as a touch. A mouse move counts too: on a desktop it is the only sign of life. */
export const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

export interface IdleWatcher {
  /** The user did something. Wakes the screen and restarts the countdown. */
  poke(): void;
  /** Stops the countdown (the recording ended); `walking` goes back to false without a notification. */
  stop(): void;
  readonly walking: boolean;
}

export interface IdleWatcherOptions {
  timeoutMs?: number;
  onChange(walking: boolean): void;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** The countdown behind walk mode, without React: after `timeoutMs` of silence it reports `true`; a poke reports `false`. */
export function createIdleWatcher({
  timeoutMs = WALK_IDLE_MS,
  onChange,
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}: IdleWatcherOptions): IdleWatcher {
  let handle: unknown;
  let walking = false;
  const arm = (): void => {
    if (handle !== undefined) clearTimer(handle);
    handle = setTimer(() => {
      handle = undefined;
      walking = true;
      onChange(true);
    }, timeoutMs);
  };
  arm();
  return {
    poke() {
      if (walking) {
        walking = false;
        onChange(false);
      }
      arm();
    },
    stop() {
      if (handle !== undefined) clearTimer(handle);
      handle = undefined;
      walking = false;
    },
    get walking() {
      return walking;
    },
  };
}

/**
 * Walk mode for a screen: `walking` turns true after 20 s without a touch while `enabled` (recording, not paused)
 * and false again on the next touch. `wake()` ends it by hand.
 */
export function useWalkMode(enabled: boolean, timeoutMs: number = WALK_IDLE_MS): { walking: boolean; wake(): void } {
  const [walking, setWalking] = useState(false);
  const watcher = useRef<IdleWatcher | null>(null);

  useEffect(() => {
    if (!enabled) {
      setWalking(false);
      return undefined;
    }
    const idle = createIdleWatcher({ timeoutMs, onChange: setWalking });
    watcher.current = idle;
    const poke = (): void => idle.poke();
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, poke, { passive: true });
    return () => {
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, poke);
      idle.stop();
      watcher.current = null;
      setWalking(false);
    };
  }, [enabled, timeoutMs]);

  const wake = useCallback(() => watcher.current?.poke(), []);
  return { walking: enabled && walking, wake };
}
