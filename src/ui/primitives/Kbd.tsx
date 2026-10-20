import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Kbd.module.css';

export interface KbdProps extends HTMLAttributes<HTMLElement> {
  /** `inverse` for a key cap on a cream/primary surface. */
  tone?: 'default' | 'inverse';
}

/** A keyboard key cap: "⌘", "K", "Esc". Mono, 11 px; for hints next to actions on desktop. */
export function Kbd({ tone = 'default', className, children, ...rest }: KbdProps) {
  return (
    <kbd className={cx(styles.kbd, tone === 'inverse' && styles.inverse, className)} {...rest}>
      {children}
    </kbd>
  );
}

/** "⌘ K" as a sequence of caps. */
export function KbdCombo({ keys, className }: { keys: readonly string[]; className?: string }) {
  return (
    <span className={cx(styles.combo, className)}>
      {keys.map((key, i) => (
        <Kbd key={`${key}-${i}`}>{key}</Kbd>
      ))}
    </span>
  );
}
