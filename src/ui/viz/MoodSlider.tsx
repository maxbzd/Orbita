import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { cx } from '../primitives/cx';
import { Display } from '../primitives/Text';
import { MoodFlower } from './MoodFlower';
import { MOOD_STEPS, clampMood, moodHex, moodSpoken, moodStep, moodWord } from './mood';
import type { MoodStep } from './mood';
import styles from './MoodSlider.module.css';
import { t } from '../../i18n';

export interface MoodSliderProps {
  /** The committed step, −3…+3. */
  value: MoodStep | number;
  /** Fired whenever the nearest step changes (also while the finger is still down). */
  onChange: (step: MoodStep) => void;
  /** Fired with the continuous finger position while dragging, and with the step on release. */
  onPreview?: (value: number) => void;
  /** Accessible name of the slider. */
  label?: string;
  /** The flower above the track (120 px) that morphs under the finger. Default true. */
  showFlower?: boolean;
  /** The mood word in display italic under the flower. Default true. */
  showWord?: boolean;
  flowerSize?: number;
  disabled?: boolean;
  className?: string;
}

const THUMB = 32;

/** Maps a pointer x inside the track to a continuous mood value. Pure, for tests. */
export function pointerToMood(clientX: number, left: number, width: number, thumb = THUMB): number {
  const usable = Math.max(1, width - thumb);
  const fraction = (clientX - left - thumb / 2) / usable;
  return clampMood(-3 + Math.min(1, Math.max(0, fraction)) * 6);
}

/**
 * Seven mood steps. The thumb follows the finger continuously and the flower morphs with it;
 * on release the value snaps to the nearest step. Keyboard: arrows, Home/End. ARIA slider.
 */
export function MoodSlider({
  value,
  onChange,
  onPreview,
  label = t('State'),
  showFlower = true,
  showWord = true,
  flowerSize = 120,
  disabled = false,
  className,
}: MoodSliderProps) {
  const step = moodStep(value);
  const [drag, setDrag] = useState<number | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const lastStep = useRef<MoodStep>(step);
  const shown = drag ?? step;
  if (drag === null) lastStep.current = step;
  const percent = ((shown + 3) / 6) * 100;

  const update = (clientX: number): void => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = pointerToMood(clientX, rect.left, rect.width);
    setDrag(next);
    onPreview?.(next);
    const nearest = moodStep(next);
    if (nearest !== lastStep.current) {
      lastStep.current = nearest;
      onChange(nearest);
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (disabled) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    update(event.clientX);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (drag !== null) update(event.clientX);
  };

  const finish = (): void => {
    if (drag === null) return;
    const snapped = moodStep(drag);
    setDrag(null);
    onPreview?.(snapped);
    if (snapped !== step) onChange(snapped);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowUp':
      case 'PageUp':
        next = step + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
      case 'PageDown':
        next = step - 1;
        break;
      case 'Home':
        next = -3;
        break;
      case 'End':
        next = 3;
        break;
      default:
        return;
    }
    event.preventDefault();
    const clamped = moodStep(next);
    if (clamped !== step) {
      lastStep.current = clamped;
      onChange(clamped);
      onPreview?.(clamped);
    }
  };

  return (
    <div className={cx(styles.root, className)} data-disabled={disabled || undefined}>
      {showFlower ? <MoodFlower value={shown} size={flowerSize} animate decorative className={styles.flower} /> : null}
      {showWord ? (
        <Display as="p" size="l" italic aria-hidden="true" className={styles.word}>
          {moodWord(shown)}
        </Display>
      ) : null}
      <div
        ref={trackRef}
        className={styles.track}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuemin={-3}
        aria-valuemax={3}
        aria-valuenow={step}
        aria-valuetext={moodSpoken(step)}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onKeyDown={onKeyDown}
      >
        <span className={styles.rail} aria-hidden="true" />
        {MOOD_STEPS.map((s) => (
          <span
            key={s}
            className={cx(styles.tick, s === moodStep(shown) && styles.tickActive)}
            style={{ left: `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${(s + 3) / 6})`, '--c': moodHex(s) } as CSSProperties}
            aria-hidden="true"
          />
        ))}
        <span
          className={cx(styles.thumb, drag !== null && styles.dragging)}
          style={{ left: `calc(${THUMB / 2}px + (100% - ${THUMB}px) * ${percent / 100})`, '--c': moodHex(shown) } as CSSProperties}
          aria-hidden="true"
        />
      </div>
      <div className={styles.ends} aria-hidden="true">
        <span>{moodWord(-3)}</span>
        <span>{moodWord(3)}</span>
      </div>
    </div>
  );
}
