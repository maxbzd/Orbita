import type { CSSProperties, HTMLAttributes } from 'react';
import { cx } from '../primitives/cx';
import { formatClock, isoDuration, spokenDuration } from './format';
import styles from './TimeDisplay.module.css';
import { t } from '../../i18n';

export interface TimeDisplayProps extends Omit<HTMLAttributes<HTMLTimeElement>, 'children'> {
  /** Current time, seconds. */
  seconds: number;
  /** Total length; shown small after a slash ("0:42 / 2:14"). */
  total?: number;
  /** hero 72 px (scrubbing), lg 40 (the record screen), md 20, sm 15 (the header "● 02:14"). */
  size?: 'hero' | 'lg' | 'md' | 'sm';
  /** Zero-pad minutes: "02:14" for a running recording, "2:14" for a player. Default: padded. */
  pad?: boolean;
  /** The finger is on the wave: the number is the thing being moved. */
  scrubbing?: boolean;
  /** Blink once a second ("ПАУЗА 02:14"). */
  blink?: boolean;
  /** What the number is, for screen readers: "Идёт запись", "Положение". Default "Время". */
  label?: string;
  /** role="timer" (a running recording). Screen readers still do not read every tick. */
  timer?: boolean;
  style?: CSSProperties;
}

/**
 * A big mono timer. Digits are tabular so the number never jitters while it counts; the name carries the
 * time in words ("2 минуты 14 секунд"), since "02:14" is read digit by digit.
 */
export function TimeDisplay({
  seconds,
  total,
  size = 'lg',
  pad = true,
  scrubbing,
  blink,
  label = t('Time'),
  timer,
  className,
  ...rest
}: TimeDisplayProps) {
  const hasTotal = typeof total === 'number' && Number.isFinite(total) && total > 0;
  return (
    <time
      className={cx(styles.time, styles[size], scrubbing && styles.scrubbing, blink && styles.blink, className)}
      dateTime={isoDuration(seconds)}
      role={timer ? 'timer' : undefined}
      aria-label={`${label}: ${spokenDuration(seconds)}${hasTotal ? t(' of {spokenDuration}', { spokenDuration: spokenDuration(total as number) }) : ''}`}
      {...rest}
    >
      <span aria-hidden="true">{formatClock(seconds, { pad })}</span>
      {hasTotal ? (
        <span className={styles.total} aria-hidden="true">
          / {formatClock(total as number, { pad })}
        </span>
      ) : null}
    </time>
  );
}
