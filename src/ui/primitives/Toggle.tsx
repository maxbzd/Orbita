import { useId } from 'react';
import type { ReactNode } from 'react';
import { cx } from './cx';
import styles from './Toggle.module.css';

export interface ToggleProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label: ReactNode;
  /** The explanation under the switch (iOS-style settings: what it does, in a sentence). */
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
}

/**
 * A settings switch with its description underneath. The whole row is one `role="switch"` button,
 * so the touch target is the full width and the description is part of the accessible description.
 */
export function Toggle({ checked, onChange, label, description, disabled, className, id }: ToggleProps) {
  const auto = useId();
  const baseId = id ?? auto;
  const labelId = `${baseId}-label`;
  const descId = `${baseId}-desc`;
  return (
    <button
      type="button"
      id={baseId}
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={description ? descId : undefined}
      disabled={disabled}
      className={cx(styles.row, className)}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.text}>
        <span id={labelId} className={styles.label}>
          {label}
        </span>
        {description ? (
          <span id={descId} className={styles.description}>
            {description}
          </span>
        ) : null}
      </span>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.thumb} />
      </span>
    </button>
  );
}
