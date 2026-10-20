import type { HTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Divider.module.css';

export interface DividerProps extends HTMLAttributes<HTMLElement> {
  orientation?: 'horizontal' | 'vertical';
  /** Leaves the left gutter free (list rows with a medallion). */
  inset?: boolean;
}

/** A hairline separator. */
export function Divider({ orientation = 'horizontal', inset, className, ...rest }: DividerProps) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cx(styles.divider, styles[orientation], inset && styles.inset, className)}
      {...rest}
    />
  );
}
