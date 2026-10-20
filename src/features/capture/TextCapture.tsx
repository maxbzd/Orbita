import { useEffect, useRef } from 'react';
import { Button, TextArea } from '../../ui/primitives';
import styles from './CaptureScreen.module.css';
import { t } from '../../i18n';

export interface TextCaptureProps {
  value: string;
  onChange(value: string): void;
  onDone(): void;
  /** Back to the voice (hidden where the microphone is refused). */
  onVoice?: () => void;
  /** Saving is in progress. */
  busy?: boolean;
  /** A recording is attached and waits: the text is saved together with it. */
  recordingPaused?: boolean;
  /** Label of the voice button: "Продолжить запись" when a recording waits. */
  voiceLabel?: string;
  error?: string;
}

/** The text mode: a field and «Готово». The same promise as the voice: saved at once, processed afterwards. */
export function TextCapture({ value, onChange, onDone, onVoice, busy, recordingPaused, voiceLabel = t('Voice'), error }: TextCaptureProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);

  const empty = value.trim() === '';
  return (
    <div className={styles.text} data-testid="text-capture">
      <TextArea
        ref={ref}
        aria-label={t('Record text')}
        placeholder={t('What is on your mind? Write as you think.')}
        value={value}
        rows={6}
        autoGrow
        maxRows={14}
        containerClassName={styles.textField}
        className={styles.textInput}
        error={error}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            if (!empty) onDone();
          }
        }}
      />
      <div className={styles.textActions}>
        {onVoice ? (
          <Button variant="secondary" iconStart="mic" onClick={onVoice}>
            {voiceLabel}
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" iconStart="check" disabled={empty} loading={busy} onClick={onDone}>
          {t('Done')}
        </Button>
      </div>
      <p className={styles.fine}>
        {t('{v}Ctrl + Enter saves too. Processing runs after saving.', { v: recordingPaused ? t('The recording is paused: the text will be saved with it. ') : '' })}
      
      </p>
    </div>
  );
}
