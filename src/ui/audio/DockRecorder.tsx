import type { CSSProperties } from 'react';
import { Orb } from '../orb/Orb';
import type { LevelInput } from '../orb/useOrbLevel';
import { Button } from '../primitives/Button';
import { cx } from '../primitives/cx';
import { IconButton } from '../primitives/IconButton';
import { spokenDuration } from './format';
import styles from './DockRecorder.module.css';
import { LevelBars } from './LevelBars';
import { TimeDisplay } from './TimeDisplay';
import { t } from '../../i18n';

export interface DockRecorderProps {
  seconds: number;
  paused?: boolean;
  level?: LevelInput;
  /** Click on the body: back to the recording screen. */
  onOpen?: () => void;
  onTogglePause?: () => void;
  onDone?: () => void;
  /** Shown in the status line while recording ("ЗАПИСЬ" by default). */
  statusLabel?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * The recorder of wide screens (docs/DESIGN.md "Навигация"): a 64 px row with a 40 px orb that listens,
 * the status and time, a longer level meter, and the two actions. Presentational, like the mini recorder.
 */
export function DockRecorder({
  seconds,
  paused = false,
  level,
  onOpen,
  onTogglePause,
  onDone,
  statusLabel = t('Record'),
  className,
  style,
}: DockRecorderProps) {
  return (
    <div
      className={cx(styles.dock, paused && styles.paused, className)}
      style={style}
      role="group"
      aria-label={paused ? t('Recording paused') : t('Recording')}
      data-testid="dock-recorder"
    >
      <button
        type="button"
        className={styles.open}
        onClick={onOpen}
        aria-label={t('Return to the recording, {spokenDuration}{v}', { spokenDuration: spokenDuration(seconds), v: paused ? t(', paused') : '' })}
      >
        <span className={styles.orb} aria-hidden="true">
          <Orb size={40} state={paused ? 'paused' : 'listening'} level={level} radar={false} />
        </span>
        <span className={styles.meta}>
          <span className={styles.status} aria-hidden="true">
            <span className={styles.dot} />
            {paused ? t('Pause') : statusLabel}
          </span>
          <TimeDisplay seconds={seconds} size="md" blink={paused} label={t('Record')} aria-hidden="true" />
        </span>
        <span className={styles.meter}>
          <LevelBars level={level} bars={24} paused={paused} />
        </span>
      </button>
      <div className={styles.actions}>
        <IconButton
          icon={paused ? 'play' : 'pause'}
          label={paused ? t('Resume recording') : t('Pause')}
          variant="glass"
          onClick={onTogglePause}
        />
        <Button variant="primary" size="sm" iconStart="check" onClick={onDone}>
          {t('Done')}
        </Button>
      </div>
    </div>
  );
}
