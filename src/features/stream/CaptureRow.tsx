import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Capture, Item } from '../../domain/types';
import { Chip, MoodFlower, Pill, Waveform, cx } from '../../ui';
import { CAPTURE_KIND_LABELS, captureSummary, captureTitle, decorativePeaks, objectChips, pendingCount, rowMeta, statusLabel } from './rowModel';
import styles from './CaptureRow.module.css';
import { t } from '../../i18n';

export interface CaptureRowProps {
  capture: Capture;
  items?: readonly Item[];
  /** Mood of the check-in written with the record, −1…+1: shows the 28 px flower. */
  mood?: number;
  /** Real peaks when they are at hand; otherwise a stable decorative capsule. */
  peaks?: ArrayLike<number>;
  /** A separate action at the right ("Разобрать", "Повторить"); it is not inside the link. */
  action?: ReactNode;
  /** Show the processing status (the inbox does, the finished stream does not). */
  showStatus?: boolean;
  className?: string;
}

const MOOD_WORD = (level: number): string => (level <= -0.34 ? t('heavy') : level >= 0.34 ? t('uplifted') : t('even', undefined, 'capture-row'));

/**
 * A record in the stream: title or summary, a capsule of its wave, the mood flower (if a check-in came with
 * it), chips of the objects found, the length. The whole row is one link to the record; chips are labels.
 */
export function CaptureRow({ capture, items = [], mood, peaks, action, showStatus, className }: CaptureRowProps) {
  const title = captureTitle(capture);
  const summary = captureSummary(capture);
  const { chips, more } = objectChips(items);
  const pending = pendingCount(items);
  const status = showStatus ? statusLabel(capture.status) : undefined;
  const isVoice = capture.kind === 'voice' || capture.audioId !== undefined;
  const failed = capture.status === 'failed';

  return (
    <article className={cx(styles.row, className)} data-testid="capture-row" data-status={capture.status}>
      <Link to={`/entry/${capture.id}`} className={styles.main}>
        <span className={styles.head}>
          <span className={styles.title}>{title}</span>
          {mood !== undefined ? <MoodFlower level={mood} size={28} label={t('State: {MOOD_WORD}', { MOOD_WORD: MOOD_WORD(mood) })} className={styles.flower} /> : null}
        </span>

        {summary ? <span className={styles.summary}>{summary}</span> : null}
        {failed && capture.error ? <span className={styles.error}>{capture.error}</span> : null}

        <span className={styles.foot}>
          <span className={styles.meta}>{rowMeta(capture)}</span>
          {isVoice ? (
            <span className={styles.capsule} aria-hidden="true">
              <Waveform peaks={peaks ?? decorativePeaks(capture.id)} height={14} reflection={false} />
            </span>
          ) : (
            <span className={styles.kind}>{CAPTURE_KIND_LABELS[capture.kind]}</span>
          )}
          {status ? (
            <Pill tone={failed ? 'danger' : capture.status === 'review' ? 'ai' : 'neutral'} dot className={styles.status}>
              {status}
            </Pill>
          ) : null}
        </span>

        {chips.length > 0 ? (
          <span className={styles.chips}>
            {chips.map((chip) => (
              <Chip key={chip.id} type={chip.kind} className={styles.chip}>
                <span className={styles.chipInner}>
                  <span className={styles.chipText}>{chip.title}</span>
                  {chip.proposed ? (
                    <>
                      <span className={styles.pending} aria-hidden="true" />
                      <span className="sr-only">{t(', awaiting confirmation')}</span>
                    </>
                  ) : null}
                </span>
              </Chip>
            ))}
            {more > 0 ? <span className={styles.more}>+{more}</span> : null}
            {pending > 0 && chips.every((chip) => !chip.proposed) ? <span className={styles.pendingNote}>{t('{pending} awaiting confirmation', { pending })}</span> : null}
          </span>
        ) : null}
      </Link>
      {action ? <div className={styles.action}>{action}</div> : null}
    </article>
  );
}
