import { useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { cx } from '../primitives/cx';
import { formatClock, spokenDuration } from './format';
import { BAR_WIDTH, REFLECTION_RATIO, barsPath, fractionAt, layoutBars, seekFromKey } from './peaks';
import { useElementWidth } from './useElementWidth';
import styles from './Waveform.module.css';
import { t } from '../../i18n';

export interface WaveformProps {
  /** Loudness per slice, 0..1 (about 180 values; any length is resampled to the width). */
  peaks: ArrayLike<number>;
  /** Played share of the recording, 0..1. */
  progress?: number;
  /** Length in seconds: gives the slider real units and the arrow keys a 5 s step. */
  durationSec?: number;
  /** Commit: a tap, the end of a drag, a key press. Without it the wave is a picture (a list row capsule). */
  onSeek?: (fraction: number) => void;
  /** While the finger or mouse is down: the fraction under it (for the big timer); null when released. */
  onScrub?: (fraction: number | null) => void;
  /** Height of the bars above the baseline, px. Default 56. */
  height?: number;
  /** The mirror image underneath (35 % tall, .4 opacity). Default true. */
  reflection?: boolean;
  /** Accessible name. Default "Положение в записи". */
  label?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * The recording as an interface: bars 2 px wide with a 1 px gap, played
 * ones in the AI gradient, the rest ink-3 at 40 %, a mirror underneath. It is also the slider: tap or drag
 * to scrub, arrow keys to step (5 s, Shift 15 s, Page 10 %, Home/End). Vertical drags still scroll.
 */
export function Waveform({
  peaks,
  progress = 0,
  durationSec,
  onSeek,
  onScrub,
  height = 56,
  reflection = true,
  label = t('Position in the recording'),
  disabled,
  className,
  style,
}: WaveformProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [scrub, setScrub] = useState<number | null>(null);
  const interactive = Boolean(onSeek) && !disabled;

  const shown = clamp(scrub ?? progress);
  const mirrorHeight = reflection ? Math.round(height * REFLECTION_RATIO) : 0;
  const totalHeight = height + mirrorHeight + (reflection ? 3 : 2);
  const baseline = height + 1;

  const bars = useMemo(() => layoutBars(peaks, width, height), [peaks, width, height]);
  const up = useMemo(() => barsPath(bars, baseline, -1), [bars, baseline]);
  const down = useMemo(() => (reflection ? barsPath(bars, baseline + 2, 1, REFLECTION_RATIO) : ''), [bars, baseline, reflection]);

  const headX = Math.round(shown * width * 100) / 100;
  const playedWidth = Math.max(0, headX);

  const fractionFromEvent = (event: PointerEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    return fractionAt(event.clientX, rect.left, rect.width);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!interactive || (event.pointerType === 'mouse' && event.button !== 0)) return;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Capture is a nicety (the drag survives leaving the element); not every environment has it.
    }
    const f = fractionFromEvent(event);
    setScrub(f);
    onScrub?.(f);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (scrub === null) return;
    const f = fractionFromEvent(event);
    setScrub(f);
    onScrub?.(f);
  };

  const finish = (event: PointerEvent<HTMLDivElement>, commit: boolean): void => {
    if (scrub === null) return;
    const f = fractionFromEvent(event);
    setScrub(null);
    onScrub?.(null);
    if (commit) onSeek?.(f);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!interactive || event.altKey || event.ctrlKey || event.metaKey) return;
    const next = seekFromKey(event.key, shown, durationSec, event.shiftKey);
    if (next === null) return;
    event.preventDefault();
    onSeek?.(next);
  };

  const hasDuration = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0;
  const nowSec = hasDuration ? shown * (durationSec as number) : 0;
  const sliderProps = interactive
    ? ({
        role: 'slider',
        tabIndex: 0,
        'aria-label': label,
        'aria-orientation': 'horizontal',
        'aria-valuemin': 0,
        'aria-valuemax': hasDuration ? Math.round(durationSec as number) : 100,
        'aria-valuenow': hasDuration ? Math.round(nowSec) : Math.round(shown * 100),
        'aria-valuetext': hasDuration
          ? t('{spokenDuration} of {spokenDuration2}', { spokenDuration: spokenDuration(nowSec), spokenDuration2: spokenDuration(durationSec as number) })
          : `${Math.round(shown * 100)} %`,
        'data-time': hasDuration ? formatClock(nowSec, { pad: false }) : undefined,
      } as const)
    : ({ role: 'img', 'aria-label': label, 'aria-disabled': disabled || undefined } as const);

  return (
    <div
      ref={ref}
      className={cx(styles.wave, !interactive && styles.static, scrub !== null && styles.scrubbing, className)}
      style={{ '--bar': `${BAR_WIDTH}px`, ...style } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      onKeyDown={onKeyDown}
      data-testid="waveform"
      {...sliderProps}
    >
      <svg className={styles.svg} width={width} height={totalHeight} viewBox={`0 0 ${width} ${totalHeight}`} aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id={`${uid}-g`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={Math.max(1, playedWidth)} y2={0}>
            <stop offset="0" style={{ stopColor: 'var(--ai-1)' }} />
            <stop offset="0.55" style={{ stopColor: 'var(--ai-2)' }} />
            <stop offset="1" style={{ stopColor: 'var(--ai-3)' }} />
          </linearGradient>
          <clipPath id={`${uid}-c`}>
            <rect x={0} y={-2} width={playedWidth} height={totalHeight + 4} />
          </clipPath>
        </defs>

        <path className={styles.rest} d={up} data-testid="wave-rest" />
        <path className={styles.played} d={up} stroke={`url(#${uid}-g)`} clipPath={`url(#${uid}-c)`} data-testid="wave-played" />
        {reflection ? (
          <g className={styles.mirror}>
            <path className={styles.rest} d={down} />
            <path className={styles.played} d={down} stroke={`url(#${uid}-g)`} clipPath={`url(#${uid}-c)`} />
          </g>
        ) : null}

        {interactive || progress > 0 ? (
          <g data-testid="wave-head">
            <line className={styles.head} x1={headX} x2={headX} y1={2} y2={baseline} />
            <circle className={styles.knob} cx={headX} cy={3} r={4} />
          </g>
        ) : null}
      </svg>
    </div>
  );
}

function clamp(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}
