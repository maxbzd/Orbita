import { audioRepo } from '../db';
import type { ID } from '../domain/types';
import { t } from '../i18n';

/** A decoded audio buffer, as far as peaks are concerned (`AudioBuffer` fits). */
export interface DecodedAudio {
  readonly duration: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export type DecodeAudio = (data: ArrayBuffer) => Promise<DecodedAudio>;

export interface Waveform {
  /** Loudness of each slice of the recording, 0..1, the loudest slice being 1. */
  peaks: number[];
  durationSec: number;
}

export interface WaveformOptions {
  /** Number of bars (default 96). */
  buckets?: number;
  /** Replaces the browser decoder (tests). */
  decode?: DecodeAudio;
}

export const DEFAULT_BUCKETS = 96;
/** Decoding turns the whole file into PCM in memory: past this size the picture is not worth the memory. */
export const MAX_DECODE_BYTES = 25 * 1024 * 1024;
/** Peaks do not need more: 8 kHz keeps an hour of speech under 120 MB of PCM. Some browsers refuse low rates, hence the fallbacks. */
const DECODE_SAMPLE_RATES = [8_000, 22_050, 44_100] as const;
const CACHE_LIMIT = 40;
const SILENCE = 1e-4;

export class WaveformError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WaveformError';
  }
}

/** Decodes with an OfflineAudioContext, which resamples to a low rate while decoding. */
export const decodeWithBrowser: DecodeAudio = async (data) => {
  const scope = globalThis as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext };
  const Context = scope.OfflineAudioContext ?? scope.webkitOfflineAudioContext;
  if (!Context) throw new WaveformError(t('The browser cannot analyze audio for the waveform'));
  for (const rate of DECODE_SAMPLE_RATES) {
    let context: OfflineAudioContext;
    try {
      context = new Context(1, 1, rate);
    } catch {
      continue;
    }
    return context.decodeAudioData(data);
  }
  throw new WaveformError(t('The browser cannot analyze audio for the waveform'));
};

/**
 * Splits samples into `buckets` equal slices and takes the largest absolute sample of each across
 * all channels; the result is scaled so that the loudest slice is 1. Silence gives zeros.
 */
export function computePeaks(channels: readonly ArrayLike<number>[], buckets: number = DEFAULT_BUCKETS): number[] {
  const length = Math.max(0, ...channels.map((channel) => channel.length));
  const peaks = new Array<number>(buckets).fill(0);
  if (length === 0 || buckets <= 0) return peaks;

  for (const channel of channels) {
    for (let bucket = 0; bucket < buckets; bucket++) {
      const from = Math.floor((bucket * length) / buckets);
      const to = Math.min(channel.length, Math.floor(((bucket + 1) * length) / buckets));
      let peak = peaks[bucket]!;
      for (let index = from; index < to; index++) peak = Math.max(peak, Math.abs(channel[index]!));
      peaks[bucket] = peak;
    }
  }
  const loudest = Math.max(...peaks);
  return loudest < SILENCE ? peaks.map(() => 0) : peaks.map((peak) => peak / loudest);
}

/** Peaks of an audio file. Rejects with `WaveformError` (Russian message) if it cannot be decoded. */
export async function computeWaveform(blob: Blob, { buckets = DEFAULT_BUCKETS, decode = decodeWithBrowser }: WaveformOptions = {}): Promise<Waveform> {
  if (blob.size > MAX_DECODE_BYTES) throw new WaveformError(t('The recording is too long to draw a waveform'));
  let audio: DecodedAudio;
  try {
    audio = await decode(await blob.arrayBuffer());
  } catch (cause) {
    if (cause instanceof WaveformError) throw cause;
    throw new WaveformError(t('Could not build the waveform of the recording'), { cause });
  }
  const channels = Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel));
  return { peaks: computePeaks(channels, buckets), durationSec: audio.duration };
}

// ───────── Cache ─────────

const cache = new Map<string, Promise<Waveform>>();

/**
 * Waveform of a stored recording (`Capture.audioId`), computed once per audio and bucket count:
 * concurrent callers share one decoding. Rejects if the audio is missing or cannot be decoded,
 * and a failure is not remembered.
 */
export function getWaveform(audioId: ID, options: WaveformOptions = {}): Promise<Waveform> {
  const key = `${audioId}:${options.buckets ?? DEFAULT_BUCKETS}`;
  const cached = cache.get(key);
  if (cached) {
    // Most recently used goes last, so the oldest entry is the one to drop.
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const waveform = (async () => {
    const audio = await audioRepo.get(audioId);
    if (!audio) throw new WaveformError(t('Recording not found'));
    return computeWaveform(audio.data, options);
  })();
  waveform.catch(() => cache.delete(key));
  cache.set(key, waveform);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return waveform;
}

export function clearWaveformCache(): void {
  cache.clear();
}
