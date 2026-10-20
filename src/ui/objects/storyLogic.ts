import { useEffect, useRef } from 'react';

/** What a finished pointer gesture on the story means. */
export type StoryGesture = 'next' | 'prev' | 'close' | 'hold' | 'none';

export interface GestureInput {
  dx: number;
  dy: number;
  /** Press duration in ms. */
  duration: number;
  /** Where the press ended across the stage, 0 (left edge) … 1 (right edge). */
  x: number;
}

export const TAP_MAX_MS = 250;
export const TAP_MAX_MOVE = 10;
export const SWIPE_MIN = 48;
export const SWIPE_CLOSE_MIN = 96;
/** The left third goes back, the rest goes forward (the Instagram convention). */
export const BACK_ZONE = 0.3;

/**
 * Classifies a pointer gesture: a short still press is a tap (left zone back, otherwise forward), a horizontal swipe
 * pages, a long swipe down closes, a long still press is a hold (pause while pressed, nothing on release).
 */
export function classifyGesture({ dx, dy, duration, x }: GestureInput): StoryGesture {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= SWIPE_MIN && ax > ay) return dx < 0 ? 'next' : 'prev';
  if (dy >= SWIPE_CLOSE_MIN && ay > ax) return 'close';
  if (ax <= TAP_MAX_MOVE && ay <= TAP_MAX_MOVE) {
    if (duration <= TAP_MAX_MS) return x < BACK_ZONE ? 'prev' : 'next';
    return 'hold';
  }
  return 'none';
}

export interface StoryClockOptions {
  /** Whether time runs (not paused, not held, visible, motion allowed). */
  running: boolean;
  /** Length of the current slide in ms. */
  duration: number;
  /** Changing this restarts the slide's clock (new slide, restart). */
  slideKey: string | number;
  /** Receives progress 0…1 on every tick (write it straight to the DOM: no React render per tick). */
  onProgress: (progress: number) => void;
  /** Called once when the slide's time is up. */
  onDone: () => void;
  /** Tick interval in ms. */
  interval?: number;
}

/**
 * The slide timer. Elapsed time is kept across pauses, so releasing a hold continues where it stopped; a new `slideKey`
 * starts from zero. Time is measured with the wall clock, so a throttled background tab does not slow the story down
 * (and the story is paused while hidden anyway).
 */
export function useStoryClock({ running, duration, slideKey, onProgress, onDone, interval = 40 }: StoryClockOptions): void {
  const elapsed = useRef(0);
  const lastKey = useRef<string | number>(slideKey);
  const done = useRef(false);
  const progressRef = useRef(onProgress);
  const doneRef = useRef(onDone);
  progressRef.current = onProgress;
  doneRef.current = onDone;

  useEffect(() => {
    if (lastKey.current !== slideKey) {
      lastKey.current = slideKey;
      elapsed.current = 0;
      done.current = false;
    }
    progressRef.current(duration > 0 ? Math.min(1, elapsed.current / duration) : 1);
    if (!running || done.current || duration <= 0) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      elapsed.current += now - last;
      last = now;
      const progress = Math.min(1, elapsed.current / duration);
      progressRef.current(progress);
      if (progress >= 1 && !done.current) {
        done.current = true;
        clearInterval(id);
        doneRef.current();
      }
    }, interval);
    return () => clearInterval(id);
  }, [running, duration, slideKey, interval]);
}
