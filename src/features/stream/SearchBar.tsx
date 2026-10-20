import { useId, useRef } from 'react';
import type { FormEvent } from 'react';
import { Button, SegmentedControl, Search } from '../../ui';
import styles from './SearchBar.module.css';
import { t } from '../../i18n';

export type SearchMode = 'find' | 'ask';

export interface SearchBarProps {
  mode: SearchMode;
  onModeChange(mode: SearchMode): void;
  value: string;
  onChange(value: string): void;
  /** "Спросить" sends the question on (to /ask?q=…). */
  onAsk(question: string): void;
}

const MODES = [
  { value: 'find', get label() { return t('Search', undefined, 'bar') }, icon: 'search' },
  { value: 'ask', get label() { return t('Ask') }, icon: 'ask' },
] as const;

/**
 * The field at the top of the stream. «Найти» filters the stream as you type; «Спросить» keeps the
 * question for the assistant and sends it to the ask screen on Enter.
 */
export function SearchBar({ mode, onModeChange, value, onChange, onAsk }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const asking = mode === 'ask';

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const question = value.trim();
    if (asking && question) onAsk(question);
  };

  return (
    <form className={styles.bar} role="search" onSubmit={submit}>
      <SegmentedControl
        aria-label={t('Field mode')}
        size="sm"
        options={MODES.map((option) => ({ value: option.value, label: option.label, icon: option.icon }))}
        value={mode}
        onChange={(next) => {
          onModeChange(next);
          inputRef.current?.focus();
        }}
      />
      <div className={styles.field}>
        <Search
          ref={inputRef}
          value={value}
          onChange={onChange}
          placeholder={asking ? t('Ask about your records') : t('Search your records')}
          aria-label={asking ? t('Question') : t('Search records')}
          aria-describedby={asking ? hintId : undefined}
          enterKeyHint={asking ? 'send' : 'search'}
          containerClassName={styles.search}
        />
        {asking ? (
          <Button type="submit" variant="ai" size="sm" iconEnd="chevron-right" disabled={value.trim() === ''}>
            {t('Ask')}
          </Button>
        ) : null}
      </div>
      {asking ? (
        <p id={hintId} className={styles.hint}>
          {t('The answer is built from your records, with links to them.')}
        </p>
      ) : null}
    </form>
  );
}
