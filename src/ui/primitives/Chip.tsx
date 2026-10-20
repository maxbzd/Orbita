import { createElement } from 'react';
import type { HTMLAttributes, MouseEventHandler, ReactNode } from 'react';
import { cx } from './cx';
import { TYPE_LABELS } from './kinds';
import type { TypeKind } from './kinds';
import { TypeDot } from './TypeMark';
import styles from './Chip.module.css';

export interface ChipProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick'> {
  /** Record type: adds the 8 px colour dot. The text stays --ink whatever the type. */
  type?: TypeKind;
  /** md 32, lg 40 (the mood-factor picker). */
  size?: 'md' | 'lg';
  /** Marks a filter chip as on (aria-pressed). Only meaningful with `onClick`. */
  selected?: boolean;
  count?: number;
  /** Anything before the label instead of the type dot (an avatar, an icon). */
  leading?: ReactNode;
  /** With a handler the chip is a button; without one it is a plain label. */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  children?: ReactNode;
}

export function Chip({ type, size = 'md', selected, count, leading, onClick, disabled, className, children, ...rest }: ChipProps) {
  const interactive = onClick !== undefined;
  const content = (
    <>
      {leading ?? (type ? <TypeDot kind={type} /> : null)}
      <span className={styles.text}>{children ?? (type ? TYPE_LABELS[type] : null)}</span>
      {count !== undefined ? <span className={styles.count}>{count}</span> : null}
    </>
  );
  const classes = cx(styles.chip, styles[size], interactive && styles.interactive, selected && styles.selected, className);
  if (!interactive) return createElement('span', { className: classes, ...rest }, content);
  return (
    <button type="button" className={classes} aria-pressed={selected} disabled={disabled} onClick={onClick} {...rest}>
      {content}
    </button>
  );
}
