import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { cx } from './cx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'ai' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * primary   the one main action of a screen: cream pill (black in "Рассвет");
   * secondary outlined; ghost text-only;
   * ai        gradient pill with DARK text, only for an action the AI performs (one per screen);
   * danger    destructive confirmation.
   */
  variant?: ButtonVariant;
  /** lg 56 (default for primary/ai), md 48, sm 44: every size meets the 44 px touch target. */
  size?: 'lg' | 'md' | 'sm';
  iconStart?: IconName;
  iconEnd?: IconName;
  /** Shows a busy state, disables the button and keeps its width. */
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size, iconStart, iconEnd, loading, fullWidth, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  const resolvedSize = size ?? (variant === 'primary' || variant === 'ai' ? 'lg' : 'md');
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(styles.button, styles[variant], styles[resolvedSize], fullWidth && styles.full, loading && styles.loading, className)}
      {...rest}
    >
      {iconStart ? <Icon name={iconStart} size={20} /> : null}
      <span className={styles.label}>{children}</span>
      {iconEnd ? <Icon name={iconEnd} size={20} /> : null}
    </button>
  );
});
