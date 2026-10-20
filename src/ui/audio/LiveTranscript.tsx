import type { CSSProperties } from 'react';
import { cx } from '../primitives/cx';
import styles from './LiveTranscript.module.css';
import { t } from '../../i18n';

export interface LiveTranscriptProps {
  /** Phrases the recogniser is sure of. */
  final: string;
  /** The phrase being spoken right now; it may still change, so it is dimmer. */
  interim?: string;
  /** How many lines are visible, 3 to 5. Default 4. */
  lines?: 3 | 4 | 5;
  /** 16 px instead of 18. */
  compact?: boolean;
  /** Shown while nothing has been said yet. Pass an empty string to show nothing. */
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * The live transcript of the recording screen. Anchored to the bottom, with a fade at the top. Sure words are
 * ink, the phrase in progress is ink-2. It is not announced to screen readers word by word (aria-live off);
 * it is a region they can read at their own pace. Render nothing at all where there is no recogniser: the
 * recording screen stays complete with the orb, the timer and the wave.
 */
export function LiveTranscript({
  final,
  interim = '',
  lines = 4,
  compact,
  placeholder = t('Speak. Words will appear here.'),
  className,
  style,
}: LiveTranscriptProps) {
  const sure = final.trim();
  const maybe = interim.trim();
  const empty = sure === '' && maybe === '';
  const count = Math.min(5, Math.max(3, lines));

  return (
    <div
      role="region"
      aria-label={t('Live text of the recording')}
      aria-live="off"
      className={cx(styles.box, compact && styles.compact, className)}
      style={{ '--lines': count, ...style } as CSSProperties}
      data-testid="live-transcript"
    >
      {empty ? (
        placeholder ? (
          <p className={styles.placeholder}>{placeholder}</p>
        ) : null
      ) : (
        <p className={styles.text}>
          {sure ? <span data-testid="transcript-final">{sure}</span> : null}
          {sure && maybe ? ' ' : null}
          {maybe ? (
            <span className={styles.interim} data-testid="transcript-interim">
              {maybe}
            </span>
          ) : null}
        </p>
      )}
    </div>
  );
}
