import { useState } from 'react';
import { Button, IconButton, MarkerLane, SegmentedControl, TimeDisplay, Waveform, formatClock } from '../../ui';
import type { AudioMarker } from '../../ui';
import { PLAYBACK_RATES } from './hooks';
import type { Player, PlaybackRate, WaveformState } from './hooks';
import styles from './PlayerCard.module.css';
import { t } from '../../i18n';

export interface PlayerCardProps {
  src: string;
  player: Player;
  wave: WaveformState;
  markers: readonly AudioMarker[];
  /** Controlled active marker (an object picked in the list); undefined follows the playhead. */
  activeMarkerId?: string | null;
  onMarkerSeek(timeSec: number, marker: AudioMarker): void;
  onAddMark(): void;
}

const RATE_OPTIONS = PLAYBACK_RATES.map((rate) => ({ value: String(rate), label: `${String(rate).replace('.', ',')}×` }));

/** Wave on the full width, the big timer, markers of what was found, play / skip / speed, "add a note here". */
export function PlayerCard({ src, player, wave, markers, activeMarkerId, onMarkerSeek, onAddMark }: PlayerCardProps) {
  const { duration, currentTime, playing, failed } = player;
  const [scrub, setScrub] = useState<number | null>(null);
  const shownTime = scrub !== null && duration > 0 ? scrub * duration : currentTime;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  return (
    <section className={styles.card} aria-label={t('Recording player')}>
      {/* The file is the source of truth for sound; the timeline above it is ours. */}
      <audio ref={player.audioRef} src={src} preload="metadata" className={styles.audio} />

      <div className={styles.timer}>
        <TimeDisplay seconds={shownTime} total={duration || undefined} size={scrub !== null ? 'hero' : 'lg'} pad={false} scrubbing={scrub !== null} label={t('Position')} />
        <SegmentedControl
          aria-label={t('Playback speed')}
          size="sm"
          options={RATE_OPTIONS}
          value={String(player.rate)}
          onChange={(value) => player.setRate(Number(value) as PlaybackRate)}
        />
      </div>

      {duration > 0 && markers.length > 0 ? (
        <MarkerLane markers={markers} durationSec={duration} currentTime={currentTime} activeId={activeMarkerId} onSeek={onMarkerSeek} />
      ) : null}

      <Waveform
        peaks={wave.peaks}
        progress={progress}
        durationSec={duration || undefined}
        height={56}
        disabled={failed || duration === 0}
        onScrub={setScrub}
        onSeek={(fraction) => player.seek(fraction * duration)}
      />
      {wave.status === 'failed' ? <p className={styles.note}>{t('Could not build the waveform, but the recording plays.')}</p> : null}
      {failed ? <p className={styles.error} role="alert">{t('This recording cannot be played in the browser. The text is saved.')}</p> : null}

      <div className={styles.controls}>
        <div className={styles.transport}>
          <Button variant="ghost" size="sm" onClick={() => player.skip(-10)} disabled={failed} aria-label={t('Back 10 seconds')}>
            {t('−10 s')}
          </Button>
          <IconButton icon={playing ? 'pause' : 'play'} label={playing ? t('Pause') : t('Play')} variant="filled" size="lg" onClick={player.toggle} disabled={failed} />
          <Button variant="ghost" size="sm" onClick={() => player.skip(10)} disabled={failed} aria-label={t('Forward 10 seconds')}>
            {t('+10 s')}
          </Button>
        </div>
        <Button variant="secondary" size="sm" iconStart="plus" onClick={onAddMark} disabled={failed}>
          
          {t('Mark at {formatClock}', { formatClock: formatClock(currentTime, { pad: false }) })}
        </Button>
      </div>
    </section>
  );
}
