import type { CSSProperties } from 'react';
import type { LevelInput } from '../orb/useOrbLevel';
import { cx } from '../primitives/cx';
import { Glass } from '../primitives/Glass';
import { IconButton } from '../primitives/IconButton';
import { spokenDuration } from './format';
import { LevelBars } from './LevelBars';
import styles from './MiniRecorder.module.css';
import { TimeDisplay } from './TimeDisplay';
import { t } from '../../i18n';

export interface MiniRecorderProps {
  /** Length of the recording so far, seconds. */
  seconds: number;
  paused?: boolean;
  /** Voice level for the four bars. */
  level?: LevelInput;
  /** A tap on the pill: back to the recording screen. */
  onOpen?: () => void;
  /** The ⏸ / ▶ button. */
  onTogglePause?: () => void;
  /** The ✓ button: save the recording at once. */
  onDone?: () => void;
  className?: string;
  style?: CSSProperties;
}

/**
 * The recorder that follows the user out of the recording screen: a glass pill above the navigation,
 * `● 02:14 ▮▮▮▮ ⏸ ✓`. Purely presentational: the shell decides where it sits (the `miniRecorder` slot) and
 * the screen that owns the recording passes the numbers and the three handlers.
 */
export function MiniRecorder({ seconds, paused = false, level, onOpen, onTogglePause, onDone, className, style }: MiniRecorderProps) {
  return (
    <Glass
      variant="real"
      size="bar"
      radius="bar"
      className={cx(styles.mini, paused && styles.paused, className)}
      style={style}
      role="group"
      aria-label={paused ? t('Recording paused') : t('Recording')}
      data-testid="mini-recorder"
    >
      <button
        type="button"
        className={styles.open}
        onClick={onOpen}
        aria-label={t('Return to the recording, {spokenDuration}{v}', { spokenDuration: spokenDuration(seconds), v: paused ? t(', paused') : '' })}
      >
        <span className={styles.dot} aria-hidden="true" />
        <TimeDisplay seconds={seconds} size="sm" blink={paused} label={t('Record')} aria-hidden="true" />
        {paused ? (
          <span className={styles.state} aria-hidden="true">
            {t('Pause')}
          </span>
        ) : null}
        <span className={styles.spacer} />
        <LevelBars level={level} bars={4} paused={paused} />
      </button>
      <IconButton
        icon={paused ? 'play' : 'pause'}
        label={paused ? t('Resume recording') : t('Pause')}
        variant="ghost"
        onClick={onTogglePause}
      />
      <IconButton icon="check" label={t('Done')} variant="filled" onClick={onDone} />
    </Glass>
  );
}
