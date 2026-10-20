import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { audioRepo } from '../../db';
import type { ID } from '../../domain/types';
import { getWaveform } from '../../audio';

// ───────── The stored recording ─────────

export type RecordingState =
  /** The record has no audio at all (typed, imported, or the sound was removed). */
  | { status: 'none' }
  | { status: 'loading' }
  /** `audioId` points at a recording that is not on this device. */
  | { status: 'missing' }
  | { status: 'ready'; url: string; mime: string; sizeBytes: number };

/** Loads the audio blob of a record and hands out an object URL for it (revoked when the screen goes). */
export function useRecording(audioId: ID | undefined): RecordingState {
  const [state, setState] = useState<RecordingState>(audioId ? { status: 'loading' } : { status: 'none' });

  useEffect(() => {
    if (!audioId) {
      setState({ status: 'none' });
      return undefined;
    }
    let alive = true;
    let url: string | undefined;
    setState({ status: 'loading' });
    audioRepo.get(audioId).then(
      (audio) => {
        if (!alive) return;
        if (!audio) {
          setState({ status: 'missing' });
          return;
        }
        url = URL.createObjectURL(audio.data);
        setState({ status: 'ready', url, mime: audio.mime, sizeBytes: audio.sizeBytes });
      },
      () => alive && setState({ status: 'missing' }),
    );
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [audioId]);

  return state;
}

/** About 180 bars. */
export const WAVE_BUCKETS = 180;

export interface WaveformState {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  peaks: number[];
  /** Length measured while decoding; used when the record has no `durationSec`. */
  durationSec?: number;
}

/** Peaks of the recording from the audio module's cache (decoded once per recording). */
export function useWaveformPeaks(audioId: ID | undefined, enabled: boolean): WaveformState {
  const [state, setState] = useState<WaveformState>({ status: 'idle', peaks: [] });

  useEffect(() => {
    if (!audioId || !enabled) {
      setState({ status: 'idle', peaks: [] });
      return undefined;
    }
    let alive = true;
    setState({ status: 'loading', peaks: [] });
    getWaveform(audioId, { buckets: WAVE_BUCKETS }).then(
      (wave) => alive && setState({ status: 'ready', peaks: wave.peaks, durationSec: wave.durationSec }),
      () => alive && setState({ status: 'failed', peaks: [] }),
    );
    return () => {
      alive = false;
    };
  }, [audioId, enabled]);

  return state;
}

// ───────── Playback ─────────

export const PLAYBACK_RATES = [1, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

export interface Player {
  audioRef: RefObject<HTMLAudioElement>;
  playing: boolean;
  /** Seconds. */
  currentTime: number;
  /** Seconds; 0 while unknown. */
  duration: number;
  rate: PlaybackRate;
  /** The browser cannot play this file. */
  failed: boolean;
  /** Something has been played or sought: the "current phrase" makes sense. */
  started: boolean;
  toggle(): void;
  pause(): void;
  seek(seconds: number): void;
  skip(deltaSeconds: number): void;
  setRate(rate: PlaybackRate): void;
}

const finitePositive = (value: number | undefined): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/**
 * State around one `<audio>` element. The recorded file often reports an unknown length (MediaRecorder
 * writes none), so `durationHint` (the record's own `durationSec`, or the measured one) wins.
 * The position is read from the element every frame while playing, so the head moves smoothly.
 */
export function useAudioPlayer(durationHint: number | undefined): Player {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [elementDuration, setElementDuration] = useState(0);
  const [rate, setRateState] = useState<PlaybackRate>(1);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);

  const duration = finitePositive(durationHint) || elementDuration;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const sync = (): void => setCurrentTime(audio.currentTime);
    const onMeta = (): void => setElementDuration(finitePositive(audio.duration));
    const onPlay = (): void => {
      setPlaying(true);
      setStarted(true);
    };
    const onPause = (): void => setPlaying(false);
    const onEnded = (): void => {
      setPlaying(false);
      sync();
    };
    const onError = (): void => setFailed(true);
    audio.addEventListener('timeupdate', sync);
    audio.addEventListener('seeked', sync);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    onMeta();
    return () => {
      audio.removeEventListener('timeupdate', sync);
      audio.removeEventListener('seeked', sync);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  });

  useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    const tick = (): void => {
      const audio = audioRef.current;
      if (audio) setCurrentTime(audio.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const seek = useCallback(
    (seconds: number) => {
      const audio = audioRef.current;
      const limit = duration || Number.POSITIVE_INFINITY;
      const target = Math.min(limit, Math.max(0, seconds));
      setCurrentTime(target);
      setStarted(true);
      if (audio) audio.currentTime = target;
    },
    [duration],
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (duration > 0 && audio.currentTime >= duration - 0.05) audio.currentTime = 0;
      audio.play().catch(() => setFailed(true));
    } else {
      audio.pause();
    }
  }, [duration]);

  const pause = useCallback(() => audioRef.current?.pause(), []);
  const skip = useCallback((delta: number) => seek((audioRef.current?.currentTime ?? 0) + delta), [seek]);
  const setRate = useCallback((next: PlaybackRate) => {
    setRateState(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, []);

  // A new source resets the playback rate on some browsers: apply the chosen one again.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate;
  });

  return { audioRef, playing, currentTime, duration, rate, failed, started, toggle, pause, seek, skip, setRate };
}
