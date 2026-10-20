import { useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import type { CaptureMark } from '../../domain/types';
import { Button, Field, IconButton, Label, formatClock } from '../../ui';
import styles from './MarksPanel.module.css';
import { t } from '../../i18n';

export interface MarkDraft {
  at: number;
  text: string;
}

export interface MarksPanelProps {
  marks: readonly CaptureMark[];
  draft: MarkDraft | null;
  onDraftChange(draft: MarkDraft | null): void;
  onSave(draft: MarkDraft): void;
  onRemove(mark: CaptureMark): void;
  onSeek(seconds: number): void;
}

/** The author's own notes pinned to seconds of the recording: a composer while one is being written, then the list. */
export function MarksPanel({ marks, draft, onDraftChange, onSave, onRemove, onSeek }: MarksPanelProps) {
  const input = useRef<HTMLInputElement>(null);
  const open = draft !== null;
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (draft && draft.text.trim() !== '') onSave({ ...draft, text: draft.text.trim() });
  };

  if (!draft && marks.length === 0) return null;

  return (
    <section className={styles.panel} aria-labelledby="entry-marks">
      <Label id="entry-marks">{t('Marks{v}', { v: marks.length > 0 ? ` · ${marks.length}` : '' })}</Label>

      {draft ? (
        <form className={styles.composer} onSubmit={submit}>
          <Field
            ref={input}
            label={t('Mark at {formatClock}', { formatClock: formatClock(draft.at, { pad: false }) })}
            placeholder={t('What matters here?')}
            value={draft.text}
            onChange={(event) => onDraftChange({ ...draft, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onDraftChange(null);
            }}
            maxLength={280}
          />
          <div className={styles.composerActions}>
            <Button type="button" variant="ghost" size="sm" onClick={() => onDraftChange(null)}>
              {t('Cancel', undefined, 'marks-panel')}
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={draft.text.trim() === ''}>
              {t('Save')}
            </Button>
          </div>
        </form>
      ) : null}

      {marks.length > 0 ? (
        <ul className={styles.list}>
          {marks.map((mark) => (
            <li key={mark.id} className={styles.row}>
              <button type="button" className={styles.time} onClick={() => onSeek(mark.at)} aria-label={t('Go to {formatClock}', { formatClock: formatClock(mark.at, { pad: false }) })}>
                {formatClock(mark.at, { pad: false })}
              </button>
              <span className={styles.text}>{mark.text}</span>
              <IconButton icon="trash" label={t('Delete the mark at {formatClock}', { formatClock: formatClock(mark.at, { pad: false }) })} onClick={() => onRemove(mark)} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
