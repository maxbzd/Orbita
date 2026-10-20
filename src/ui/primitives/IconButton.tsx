import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { cx } from './cx';
import styles from './IconButton.module.css';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  icon: IconName;
  /** Required: an icon-only control has no other name. */
  label: string;
  /** ghost: bare; glass: translucent disc (use over an aura); filled: cream disc (the main action). */
  variant?: 'ghost' | 'glass' | 'filled';
  /** md 44, lg 56. */
  size?: 'md' | 'lg';
  /** Toggle state (aria-pressed). Leave undefined for plain buttons. */
  pressed?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'ghost', size = 'md', pressed, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cx(styles.button, styles[variant], styles[size], className)}
      {...rest}
    >
      <Icon name={icon} size={size === 'lg' ? 28 : 24} />
    </button>
  );
});
