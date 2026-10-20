import type { CSSProperties } from 'react';
import { Button } from '../primitives/Button';
import { cx } from '../primitives/cx';
import { IconButton } from '../primitives/IconButton';
import styles from './RecordControls.module.css';
import { t } from '../../i18n';

export interface RecordControlsProps {
  /** The recording is paused: the right button becomes "Продолжить". */
  paused?: boolean;
  /** `⌨ Текст`: switch to typing. */
  onText?: () => void;
  /** `Готово`: save at once, without waiting for the network. */
  onDone?: () => void;
  /** `⏸ Пауза` / `▶ Продолжить`. */
  onTogglePause?: () => void;
  /** Hides the text control (a screen that has no typed fallback). */
  hideText?: boolean;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * The three organs of the recording screen: Текст (56) · Готово (72, the cream pill) · Пауза (56).
 * No more than three, ever. "Готово" is the one main action of the screen and saves at once.
 */
export function RecordControls({ paused = false, onText, onDone, onTogglePause, hideText, disabled, className, style }: RecordControlsProps) {
  return (
    <div className={cx(styles.controls, className)} style={style} role="group" aria-label={t('Recording controls')}>
      {hideText ? (
        <span />
      ) : (
        <div className={styles.side}>
          <IconButton icon="text" label={t('Text')} variant="glass" size="lg" onClick={onText} disabled={disabled} />
          <span className={styles.caption} aria-hidden="true">
            {t('Text')}
          </span>
        </div>
      )}

      <Button variant="primary" size="lg" iconStart="check" className={styles.done} onClick={onDone} disabled={disabled}>
        {t('Done')}
      </Button>

      <div className={styles.side}>
        <IconButton
          icon={paused ? 'play' : 'pause'}
          label={paused ? t('Continue') : t('Pause')}
          variant="glass"
          size="lg"
          onClick={onTogglePause}
          disabled={disabled}
        />
        <span className={styles.caption} aria-hidden="true">
          {paused ? t('Continue') : t('Pause')}
        </span>
      </div>
    </div>
  );
}
