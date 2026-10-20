import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Badge.module.css';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** A number; omit for a bare dot ("something is waiting for confirmation"). */
  count?: number;
  /** Counts above this show as "99+". */
  max?: number;
  tone?: 'neutral' | 'accent' | 'danger';
  /** Accessible description, e.g. "3 неразобранных". Required for a bare dot to mean anything. */
  label?: string;
}

/** A small count or dot. Never red by default: nothing in "Орбита" shouts. */
export function Badge({ count, max = 99, tone = 'accent', label, className, ...rest }: BadgeProps) {
  if (count === 0) return null;
  const text = count === undefined ? null : count > max ? `${max}+` : String(count);
  return (
    <span
      className={cx(styles.badge, styles[tone], text === null && styles.dot, className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      {...rest}
    >
      {text}
    </span>
  );
}
