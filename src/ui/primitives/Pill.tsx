import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './Pill.module.css';

export type PillTone = 'neutral' | 'rec' | 'ok' | 'warn' | 'danger' | 'ai';

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  /** Colours the dot (and the text, for `danger`). Text is --ink otherwise. */
  tone?: PillTone;
  /** Leading status dot. */
  dot?: boolean;
  /** Blinks once a second (the "ПАУЗА" state); off under reduced motion. */
  blink?: boolean;
  /** Announces changes to screen readers (role="status"). */
  live?: boolean;
  children?: ReactNode;
}

const DOT: Record<PillTone, string> = {
  neutral: 'var(--ink-2)',
  rec: 'var(--rec)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
  ai: 'var(--ai-2)',
};

/**
 * The AI status pill: one shape everywhere ("ЗАПИСЫВАЮ", "СТРУКТУРИРУЮ…", "ЗАПИСАНО").
 * Mono caps 12 px, 32 px tall.
 */
export function Pill({ tone = 'neutral', dot, blink, live, className, style, children, ...rest }: PillProps) {
  return (
    <span
      className={cx(styles.pill, tone === 'danger' && styles.danger, blink && styles.blink, className)}
      style={{ '--dot': DOT[tone], ...style } as CSSProperties}
      role={live ? 'status' : undefined}
      {...rest}
    >
      {dot ? <span className={styles.dot} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
