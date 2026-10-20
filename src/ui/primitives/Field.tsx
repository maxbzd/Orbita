import { forwardRef, useEffect, useId, useImperativeHandle, useRef } from 'react';
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { Icon } from '../icons';
import { cx } from './cx';
import styles from './Field.module.css';
import { t } from '../../i18n';

/** Shared chrome: label above, hint or error below, optional leading/trailing slots. */
interface ChromeProps {
  label?: string;
  hint?: ReactNode;
  /** An error replaces the hint, turns the border red and sets aria-invalid. */
  error?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
}

function useFieldIds(explicit: string | undefined, hint: ReactNode, error: ReactNode) {
  const auto = useId();
  const id = explicit ?? auto;
  const hintId = hint && !error ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return { id, hintId, errorId, describedBy: errorId ?? hintId };
}

function Messages({ hintId, errorId, hint, error }: { hintId?: string; errorId?: string; hint: ReactNode; error: ReactNode }) {
  if (error) {
    return (
      <p id={errorId} className={styles.error} role="alert">
        <Icon name="alert" size={16} />
        {error}
      </p>
    );
  }
  return hint ? (
    <p id={hintId} className={styles.hint}>
      {hint}
    </p>
  ) : null;
}

export interface FieldProps extends ChromeProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Wrapper class (the input itself takes none). */
  containerClassName?: string;
}

/** Single-line input: 48 px, radius 12, border in the control stroke (3.5:1), 16 px text. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, leading, trailing, id: explicitId, className, containerClassName, ...rest },
  ref,
) {
  const { id, hintId, errorId, describedBy } = useFieldIds(explicitId, hint, error);
  return (
    <div className={cx(styles.field, containerClassName)}>
      {label ? (
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      ) : null}
      <div className={cx(styles.control, error ? styles.invalid : undefined)}>
        {leading ? <span className={styles.slot}>{leading}</span> : null}
        <input
          ref={ref}
          id={id}
          className={cx(styles.input, className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        {trailing ? <span className={styles.slot}>{trailing}</span> : null}
      </div>
      <Messages hintId={hintId} errorId={errorId} hint={hint} error={error} />
    </div>
  );
});

export interface TextAreaProps extends ChromeProps, TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grows with its content up to `maxRows`. */
  autoGrow?: boolean;
  maxRows?: number;
  containerClassName?: string;
}

/** Multi-line input. Min 3 rows by default; `autoGrow` for composers and notes. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, leading, trailing, id: explicitId, className, containerClassName, autoGrow, maxRows = 10, rows = 3, value, onChange, ...rest },
  ref,
) {
  const { id, hintId, errorId, describedBy } = useFieldIds(explicitId, hint, error);
  const inner = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);

  useEffect(() => {
    const el = inner.current;
    if (!autoGrow || !el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 24;
    const max = line * maxRows + 24;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, [autoGrow, maxRows, value]);

  return (
    <div className={cx(styles.field, containerClassName)}>
      {label ? (
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
      ) : null}
      <div className={cx(styles.control, styles.multiline, error ? styles.invalid : undefined)}>
        {leading ? <span className={styles.slot}>{leading}</span> : null}
        <textarea
          ref={inner}
          id={id}
          rows={rows}
          value={value}
          onChange={onChange}
          className={cx(styles.input, styles.textarea, className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...rest}
        />
        {trailing ? <span className={styles.slot}>{trailing}</span> : null}
      </div>
      <Messages hintId={hintId} errorId={errorId} hint={hint} error={error} />
    </div>
  );
});

export interface SearchProps extends Omit<FieldProps, 'leading' | 'trailing' | 'type' | 'value' | 'onChange'> {
  value: string;
  onChange(value: string): void;
  /** Called when the clear button is pressed (after the value is reset to ""). */
  onClear?(): void;
  clearLabel?: string;
}

/** A search field: magnifier, native clear semantics, Escape clears. */
export const Search = forwardRef<HTMLInputElement, SearchProps>(function Search(
  { value, onChange, onClear, clearLabel = t('Empty'), placeholder = t('Search'), onKeyDown, ...rest },
  ref,
) {
  return (
    <Field
      ref={ref}
      type="search"
      role="searchbox"
      inputMode="search"
      enterKeyHint="search"
      autoComplete="off"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (!e.defaultPrevented && e.key === 'Escape' && value) {
          e.preventDefault();
          e.stopPropagation();
          onChange('');
          onClear?.();
        }
      }}
      leading={<Icon name="search" size={20} />}
      trailing={
        value ? (
          <button
            type="button"
            className={styles.clear}
            aria-label={clearLabel}
            onClick={() => {
              onChange('');
              onClear?.();
            }}
          >
            <Icon name="close" size={18} />
          </button>
        ) : null
      }
      {...rest}
    />
  );
});
