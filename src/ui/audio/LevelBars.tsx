import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { smoothLevel } from '../orb/geometry';
import { readLevel } from '../orb/useOrbLevel';
import type { LevelInput } from '../orb/useOrbLevel';
import { useOrbActive } from '../orb/useOrbActive';
import { cx } from '../primitives/cx';
import styles from './LevelBars.module.css';

export interface LevelBarsProps {
  /** Voice level 0..1: a number, or the ref from `useOrbLevel`. */
  level?: LevelInput;
  /** Number of bars: 4 in the mini recorder, more in the dock. */
  bars?: number;
  /** Frozen at a low line (paused). */
  paused?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** The meter updates this many times a second: it is a tiny widget, not the hero. */
const TICK_MS = 1000 / 20;

/** A fixed profile for a static level: the middle bars are the tallest, so a number still looks like a voice. */
export function staticProfile(count: number, level: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const centre = count > 1 ? 1 - Math.abs(i / (count - 1) - 0.5) * 1.1 : 1;
    out.push(Math.min(1, Math.max(0, level * centre)));
  }
  return out;
}

/** Pushes `value` in at the right and drops the oldest at the left: a shift register of the last N levels. */
export function pushHistory(history: readonly number[], value: number): number[] {
  if (history.length === 0) return [];
  return [...history.slice(1), value];
}

/**
 * The level meter of the mini recorder and the dock: a handful of bars that show the last moments of the
 * voice. A function, not decoration: it keeps working under reduced motion. Decorative for assistive tech.
 */
export function LevelBars({ level = 0, bars = 4, paused, className, style }: LevelBarsProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const active = useOrbActive(rootRef);
  const levelRef = useRef<LevelInput>(level);
  useEffect(() => {
    levelRef.current = level;
  });
  const isNumber = typeof level === 'number';

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const cells = Array.from(root.children) as HTMLElement[];
    const apply = (values: readonly number[]): void => {
      values.forEach((value, i) => cells[i]?.style.setProperty('--h', value.toFixed(3)));
    };

    if (paused) {
      apply(new Array<number>(bars).fill(0));
      return undefined;
    }
    if (isNumber) {
      apply(staticProfile(bars, readLevel(level)));
      return undefined;
    }
    if (!active) return undefined;

    let history: number[] = new Array<number>(bars).fill(0);
    let smoothed = 0;
    let raf = 0;
    let last = -1;
    let lastTick = -Infinity;
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      if (last < 0) last = now;
      smoothed = smoothLevel(smoothed, readLevel(levelRef.current, now), now - last);
      last = now;
      if (now - lastTick < TICK_MS) return;
      lastTick = now;
      history = pushHistory(history, smoothed);
      apply(history);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, bars, paused, isNumber, level]);

  return (
    <span ref={rootRef} className={cx(styles.bars, paused && styles.paused, className)} style={style} aria-hidden="true" data-testid="level-bars">
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className={styles.bar} />
      ))}
    </span>
  );
}
