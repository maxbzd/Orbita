import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Icon } from '../icons';
import type { IconName } from '../icons';
import { cx } from './cx';
import styles from './SegmentedControl.module.css';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentOption<T>>;
  value: T;
  onChange(value: T): void;
  /** Names the group for screen readers ("Период"). */
  'aria-label': string;
  size?: 'md' | 'sm';
  fullWidth?: boolean;
  className?: string;
}

/**
 * Single choice among a few views (День · Неделя · Месяц · Год; Время · Люди · Паттерны).
 * A radio group with a roving tabindex: arrows move and select, Home/End jump.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  fullWidth,
  className,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, step: 1 | -1 | 'first' | 'last') => {
    const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
    if (enabled.length === 0) return;
    let target: number | undefined;
    if (step === 'first') target = enabled[0];
    else if (step === 'last') target = enabled[enabled.length - 1];
    else {
      const pos = enabled.indexOf(from);
      target = enabled[(pos + step + enabled.length) % enabled.length];
    }
    if (target === undefined) return;
    const option = options[target];
    if (!option) return;
    onChange(option.value);
    refs.current[target]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        move(index, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        move(index, -1);
        break;
      case 'Home':
        event.preventDefault();
        move(index, 'first');
        break;
      case 'End':
        event.preventDefault();
        move(index, 'last');
        break;
    }
  };

  const selectedIndex = options.findIndex((o) => o.value === value);

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx(styles.group, styles[size], fullWidth && styles.full, className)}>
      {options.map((option, index) => {
        const checked = option.value === value;
        // Roving tabindex: the selected segment (or the first one, if none is selected) takes Tab.
        const tabStop = checked || (selectedIndex === -1 && index === 0);
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={tabStop ? 0 : -1}
            disabled={option.disabled}
            className={cx(styles.segment, checked && styles.checked)}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            {option.icon ? <Icon name={option.icon} size={18} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
