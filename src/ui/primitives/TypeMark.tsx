import type { CSSProperties, HTMLAttributes } from 'react';
import { Icon } from '../icons';
import { cx } from './cx';
import { TYPE_ICONS, TYPE_LABELS, typeColor } from './kinds';
import type { TypeKind } from './kinds';
import styles from './TypeMark.module.css';

/**
 * The two ways a record type is shown:
 *   TypeDot       8 px dot, colour only (always next to the type's name or a glyph);
 *   TypeMedallion 40 px circle: 1 px border at 55 %, fill at 14 %, the type's own glyph in its colour.
 * Text beside them stays --ink; the colour never carries the meaning on its own.
 */

export interface TypeDotProps extends HTMLAttributes<HTMLSpanElement> {
  kind: TypeKind;
  size?: number;
}

export function TypeDot({ kind, size = 8, className, style, ...rest }: TypeDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.dot, className)}
      style={{ '--c': typeColor(kind), width: size, height: size, ...style } as CSSProperties}
      data-kind={kind}
      {...rest}
    />
  );
}

export interface TypeMedallionProps extends HTMLAttributes<HTMLSpanElement> {
  kind: TypeKind;
  /** Diameter in px: 40 (default), 36 in the review list. */
  size?: number;
  /** Adds the type's name as an accessible label; otherwise the medallion is decorative. */
  labelled?: boolean;
}

export function TypeMedallion({ kind, size = 40, labelled, className, style, ...rest }: TypeMedallionProps) {
  return (
    <span
      className={cx(styles.medallion, className)}
      style={{ '--c': typeColor(kind), width: size, height: size, ...style } as CSSProperties}
      data-kind={kind}
      {...(labelled ? { role: 'img', 'aria-label': TYPE_LABELS[kind] } : { 'aria-hidden': true })}
      {...rest}
    >
      <Icon name={TYPE_ICONS[kind]} size={Math.round(size * 0.55)} />
    </span>
  );
}
