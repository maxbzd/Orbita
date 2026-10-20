import type { CSSProperties, HTMLAttributes } from 'react';
import { cx } from './cx';
import styles from './Skeleton.module.css';

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** Any CSS length. Default 100%. */
  width?: number | string;
  /** Any CSS length. Default 1em of body text (16 px). */
  height?: number | string;
  /** `text` radius 6, `block` 16 (a card), `circle` a disc. */
  shape?: 'text' | 'block' | 'circle';
  /** More than one line: a stack of text lines, the last one shorter. */
  lines?: number;
  /** Screen reader text. The placeholder itself is decorative. */
  label?: string;
}

const px = (value: number | string): string => (typeof value === 'number' ? `${value}px` : value);

/**
 * A loading placeholder with a slow shimmer (off under reduced motion: it becomes a still tint).
 * Use it where the final layout is known; never as a fake progress indicator.
 */
export function Skeleton({ width = '100%', height, shape = 'text', lines = 1, label, className, style, ...rest }: SkeletonProps) {
  const count = Math.max(1, Math.floor(lines));
  const bars = Array.from({ length: count }, (_, i) => (
    <span
      key={i}
      className={cx(styles.bar, styles[shape])}
      style={
        {
          width: count > 1 && i === count - 1 ? '62%' : px(width),
          height: height === undefined ? (shape === 'text' ? '1em' : undefined) : px(height),
        } as CSSProperties
      }
      aria-hidden="true"
    />
  ));
  return (
    <span className={cx(styles.root, count > 1 && styles.stack, className)} style={style} role="status" aria-busy="true" {...rest}>
      {bars}
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}
