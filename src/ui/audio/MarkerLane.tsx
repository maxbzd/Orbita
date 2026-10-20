import { useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { cx } from '../primitives/cx';
import { TYPE_LABELS } from '../primitives/kinds';
import { TypeDot } from '../primitives/TypeMark';
import { formatClock } from './format';
import { activeMarkerAt, pillSide, placeMarkers } from './lanes';
import type { AudioMarker } from './lanes';
import styles from './MarkerLane.module.css';
import { useElementWidth } from './useElementWidth';
import { t } from '../../i18n';

export interface MarkerLaneProps {
  markers: readonly AudioMarker[];
  /** Length of the recording, seconds. */
  durationSec: number;
  /** Playback position: the marker just passed becomes the active one (unless `activeId` is given). */
  currentTime?: number;
  /** Controlled: the active marker. `null` means none; leave undefined to follow `currentTime`. */
  activeId?: string | null;
  /** A tap on a marker: go to its second. */
  onSeek?: (timeSec: number, marker: AudioMarker) => void;
  /** Accessible name of the group. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const LANE_HEIGHT = 28;

/**
 * What the extraction found, on the timeline: typed dots on two lanes
 * above the waveform. The active marker unfolds into a pill with its wording and time; a tap goes to that
 * second. Colour is only in the dot, the text stays ink; every marker is a button with its type spelled out.
 */
export function MarkerLane({
  markers,
  durationSec,
  currentTime,
  activeId,
  onSeek,
  label = t('What was found in the recording'),
  className,
  style,
}: MarkerLaneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const placed = useMemo(() => placeMarkers(markers, durationSec, width), [markers, durationSec, width]);

  const active = useMemo(() => {
    if (activeId !== undefined) return activeId;
    if (currentTime === undefined) return null;
    return activeMarkerAt(markers, currentTime)?.id ?? null;
  }, [activeId, currentTime, markers]);

  if (placed.length === 0) return null;

  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className={cx(styles.lane, className)}
      style={{ '--lane-h': `${LANE_HEIGHT}px`, ...style } as CSSProperties}
      data-testid="marker-lane"
    >
      {placed.map(({ marker, fraction, lane }) => {
        const isActive = marker.id === active;
        const side = pillSide(fraction);
        const at = formatClock(marker.time, { pad: false });
        return (
          <button
            key={marker.id}
            type="button"
            className={cx(styles.marker, isActive && styles.active, isActive && styles[side])}
            style={{ '--at': Math.round(fraction * 10000) / 100, '--lane-index': lane } as CSSProperties}
            aria-label={t('{v}: {label}. Go to {at}', { v: TYPE_LABELS[marker.kind], label: marker.label, at })}
            aria-current={isActive ? 'true' : undefined}
            data-kind={marker.kind}
            data-lane={lane}
            data-active={isActive || undefined}
            onClick={() => onSeek?.(marker.time, marker)}
          >
            <span className={styles.inner}>
              <span className={styles.dotWrap}>
                <TypeDot kind={marker.kind} size={isActive ? 10 : 8} className={styles.dot} />
              </span>
              {isActive ? (
                <>
                  <span className={styles.text}>{marker.label}</span>
                  <span className={styles.time}>{at}</span>
                </>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
