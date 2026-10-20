import { useEffect, useRef } from 'react';
import { clamp01 } from './geometry';

/**
 * A live value that changes faster than React should render (the microphone level, 30-60 times a second).
 * The orb and the level meters read `current` inside their own animation frames.
 */
export interface LevelRef {
  current: number;
  /** performance.now() of the last write; lets readers treat a silent source as level 0. */
  updatedAt?: number;
}

/** Called with each new level, 0..1. */
export type LevelListener = (level: number) => void;

/**
 * Anything that can push levels: `(listener) => unsubscribe`. The orb does not know where the numbers come
 * from (an analyser node, a mock, a test); the screen that owns the recorder passes the subscription.
 */
export type LevelSubscribe = (listener: LevelListener) => (() => void) | void;

/** A level given as a plain number (re-renders on change) or as a ref that is written without rendering. */
export type LevelInput = number | LevelRef;

/** What `useOrbLevel` can listen to: a subscribe function, or any object with a `subscribe` method (a meter). */
export type LevelSubscribable = LevelSubscribe | { subscribe: LevelSubscribe };

/** A source that has not spoken for this long counts as silence (the recorder was stopped, the tab slept). */
export const LEVEL_STALE_MS = 500;

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Reads a level source: clamped to 0..1, and 0 for a ref that has gone quiet. */
export function readLevel(source: LevelInput | undefined, at: number = now()): number {
  if (source === undefined) return 0;
  if (typeof source === 'number') return clamp01(source);
  if (source.updatedAt !== undefined && at - source.updatedAt > LEVEL_STALE_MS) return 0;
  return clamp01(source.current);
}

/**
 * Subscribes to a level source and exposes it as a ref, without re-rendering. Pass the ref (or a stable
 * `subscribe`) down to `<Orb level={ref}>`.
 *
 *   const level = useOrbLevel(recorder ? recorder.onLevel : undefined);
 *   <Orb state="listening" level={level} />
 *
 * `source` must be referentially stable (a meter object, or a function wrapped in useCallback): a new
 * identity means a new subscription. Without a source (or with `enabled` false) the level stays at 0.
 * A level meter of `src/audio` (`{ subscribe(listener): unsubscribe }`) can be passed as it is.
 */
export function useOrbLevel(source: LevelSubscribable | null | undefined, enabled = true): LevelRef {
  const ref = useRef<LevelRef>({ current: 0 });

  useEffect(() => {
    const level = ref.current;
    level.current = 0;
    level.updatedAt = undefined;
    if (!source || !enabled) return undefined;
    const subscribe: LevelSubscribe = typeof source === 'function' ? source : (listener) => source.subscribe(listener);
    const unsubscribe = subscribe((value) => {
      level.current = clamp01(value);
      level.updatedAt = now();
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
      level.current = 0;
      level.updatedAt = undefined;
    };
  }, [source, enabled]);

  return ref.current;
}
