import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { useReducedMotion } from '../../styles/theme';
import { cx } from '../primitives/cx';
import styles from './CssOrb.module.css';
import { smoothLevel } from './geometry';
import type { OrbState } from './model';
import { readLevel } from './useOrbLevel';
import type { LevelInput } from './useOrbLevel';
import { useOrbActive } from './useOrbActive';

export interface CssOrbProps {
  state?: OrbState;
  /** Voice level 0..1: a number, or a ref written by `useOrbLevel`. */
  level?: LevelInput;
  /** Diameter in CSS px. */
  size?: number;
  /** Accessible name. Without it the orb is decorative (the status text next to it carries the state). */
  label?: string;
  pauseUnderOverlay?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** The level meter loop of the CSS orb runs at this rate: it only moves a brightness and a ring width. */
const METER_INTERVAL_MS = 1000 / 15;

/**
 * The CSS orb: a gradient sphere with a small state vocabulary (listening brightness and ring, paused and
 * error desaturation, the ring of "thinking", the flash of "done"). It is what `Orb` becomes on the low tier,
 * under reduced motion and where there is no 2D canvas. Microphone feedback stays under reduced motion, as
 * brightness and ring thickness instead of scale and noise.
 */
export function CssOrb({
  state = 'idle',
  level = 0,
  size = 220,
  label,
  pauseUnderOverlay = true,
  className,
  style,
}: CssOrbProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const active = useOrbActive(rootRef, pauseUnderOverlay);
  const levelRef = useRef<LevelInput>(level);
  useEffect(() => {
    levelRef.current = level;
  });

  // Level -> --level. Only while listening; a numeric level also arrives through the inline style below.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    if (state !== 'listening') {
      el.style.setProperty('--level', '0');
      return undefined;
    }
    if (!active) return undefined;

    let raf = 0;
    let value = 0;
    let last = -1;
    let lastWrite = -Infinity;
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      if (last < 0) last = now;
      const dt = now - last;
      last = now;
      value = smoothLevel(value, readLevel(levelRef.current, now), dt);
      if (now - lastWrite < METER_INTERVAL_MS) return;
      lastWrite = now;
      el.style.setProperty('--level', value.toFixed(3));
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state, active]);

  const labelled = label ? ({ role: 'img', 'aria-label': label } as const) : ({ 'aria-hidden': true } as const);

  return (
    <span
      ref={rootRef}
      className={cx(styles.orb, className)}
      style={{ '--orb-size': `${size}px`, ...style } as CSSProperties}
      data-engine="css"
      data-state={state}
      data-reduced={reduced ? 'true' : undefined}
      {...labelled}
    >
      <span className={styles.halo} />
      <span className={styles.body}>
        <span className={styles.sheen} />
      </span>
      <span className={styles.ring} />
      <span className={styles.flash} />
    </span>
  );
}
