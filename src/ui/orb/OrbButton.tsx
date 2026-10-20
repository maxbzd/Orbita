import type { CSSProperties, MouseEventHandler } from 'react';
import { cx } from '../primitives/cx';
import { Orb } from './Orb';
import styles from './OrbButton.module.css';
import type { OrbState } from './model';
import type { LevelInput } from './useOrbLevel';
import { t } from '../../i18n';

export interface OrbButtonProps {
  /** Visual state of the orb. While `recording` and left at `idle` it shows `listening`. */
  state?: OrbState;
  level?: LevelInput;
  /** Diameter in px: 68 in the navigation pill (the default), 40 in a header. */
  size?: number;
  /** A recording is running: the orb listens and a ring pulses. */
  recording?: boolean;
  /** Accessible name of the button ("Записать"). */
  label?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  /**
   * false renders a plain span with the same look and no button semantics. Use it where a parent already is
   * the button: the sphere slot of NavPill wraps its content in one, and a button inside a button is invalid.
   */
  interactive?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Dots in the light orb of a button: dense enough at 68 px, far fewer than the 1 200 of the hero. */
const BUTTON_POINTS = 220;
/** Frame rate of the light orb: a button is never the hero (§3.4 budget, "лёгкая версия"). */
export const BUTTON_FPS = 12;

/**
 * The sphere as a button: the centre of the navigation pill and the record control of the dock. A light
 * orb (about 220 dots, 12 fps) that listens and pulses while a recording runs. Startup must never wait
 * for it: it only draws, `onClick` does the work.
 */
export function OrbButton({
  state,
  level,
  size = 68,
  recording = false,
  label = t('Record', undefined, 'orb-button'),
  onClick,
  disabled,
  interactive = true,
  className,
  style,
}: OrbButtonProps) {
  const shown: OrbState = state ?? (recording ? 'listening' : 'idle');
  const classes = cx(styles.button, recording && styles.recording, className);
  const vars = { '--orb-button-size': `${size}px`, ...style } as CSSProperties;
  const inner = (
    <>
      <span className={styles.pulse} aria-hidden="true" />
      <Orb state={shown} level={level} size={size} points={BUTTON_POINTS} fps={BUTTON_FPS} radar={false} />
    </>
  );

  if (!interactive) {
    return (
      <span className={classes} style={vars} aria-hidden="true" data-recording={recording || undefined}>
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={classes}
      style={vars}
      aria-label={label}
      aria-pressed={recording || undefined}
      disabled={disabled}
      onClick={onClick}
      data-recording={recording || undefined}
    >
      {inner}
    </button>
  );
}
