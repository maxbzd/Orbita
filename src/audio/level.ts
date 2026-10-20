/** A number between 0 (silence) and 1 (loud) that changes over time: drives the orb while recording. */
export interface LevelSource {
  readonly value: number;
  /** Called on every change with the new level; returns the unsubscribe function. */
  subscribe(listener: (level: number) => void): () => void;
}

/** The part of `AnalyserNode` the meter reads. */
export interface AnalyserLike {
  readonly fftSize: number;
  getFloatTimeDomainData(array: Float32Array<ArrayBuffer>): void;
}

export interface FrameScheduler {
  request(callback: (timeMs: number) => void): number;
  cancel(handle: number): void;
}

/** Animation frames while the page is visible; a 50 ms timer where there is no `requestAnimationFrame`. */
export const browserFrameScheduler: FrameScheduler = {
  request(callback) {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(callback);
    return setTimeout(() => callback(performance.now()), 50) as unknown as number;
  },
  cancel(handle) {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
    else clearTimeout(handle);
  },
};

/** Quietest and loudest levels that matter for speech, in dBFS: room noise is below, shouting above. */
const FLOOR_DB = -55;
const CEILING_DB = -12;
/** Rises fast, falls slowly: the orb should flash on a word and fade out, not flicker. */
const ATTACK_MS = 50;
const RELEASE_MS = 220;
const FIRST_FRAME_MS = 16;
/** Changes smaller than this are not reported, so a silent room causes no events. */
const EPSILON = 0.002;

/** RMS of the samples mapped from dBFS onto 0..1. */
export function levelOfSamples(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  const db = 20 * Math.log10(Math.max(rms, 1e-8));
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB)));
}

/**
 * Smoothed microphone level for visualization, read from an AnalyserNode once per frame. It is
 * its own data stream: nothing else in the recorder waits for it, and it can be attached, paused
 * and detached while the recorder keeps running.
 */
export class LevelMeter implements LevelSource {
  /** What listeners were last told. */
  private current = 0;
  /** The exact smoothed level; `current` follows it in steps of at least `EPSILON`. */
  private smoothed = 0;
  private analyser: AnalyserLike | undefined;
  private samples: Float32Array<ArrayBuffer> | undefined;
  private handle: number | undefined;
  private lastFrameMs: number | undefined;
  private readonly listeners = new Set<(level: number) => void>();

  constructor(private readonly scheduler: FrameScheduler = browserFrameScheduler) {}

  get value(): number {
    return this.current;
  }

  subscribe(listener: (level: number) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Starts reading from the analyser. */
  attach(analyser: AnalyserLike): void {
    this.detach();
    this.analyser = analyser;
    this.samples = new Float32Array(analyser.fftSize);
    this.resume();
  }

  /** Stops reading and lets the level drop to 0 (a paused recording is silent). */
  pause(): void {
    if (this.handle !== undefined) this.scheduler.cancel(this.handle);
    this.handle = undefined;
    this.lastFrameMs = undefined;
    this.smoothed = 0;
    this.report(0);
  }

  resume(): void {
    if (!this.analyser || this.handle !== undefined) return;
    this.handle = this.scheduler.request(this.frame);
  }

  detach(): void {
    this.pause();
    this.analyser = undefined;
    this.samples = undefined;
  }

  private readonly frame = (timeMs: number): void => {
    const { analyser, samples } = this;
    if (!analyser || !samples) return;
    analyser.getFloatTimeDomainData(samples);
    const target = levelOfSamples(samples);
    const elapsed = this.lastFrameMs === undefined ? FIRST_FRAME_MS : Math.max(0, timeMs - this.lastFrameMs);
    this.lastFrameMs = timeMs;
    const smoothing = 1 - Math.exp(-elapsed / (target > this.smoothed ? ATTACK_MS : RELEASE_MS));
    this.smoothed += (target - this.smoothed) * smoothing;
    this.report(this.smoothed);
    this.handle = this.scheduler.request(this.frame);
  };

  private report(level: number): void {
    const next = level < EPSILON ? 0 : level;
    if (next === this.current || (next !== 0 && Math.abs(next - this.current) < EPSILON)) return;
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }
}

/** An analyser fed by a media stream, plus the way to release the audio context behind it. */
export interface StreamAnalyser {
  analyser: AnalyserLike;
  close(): Promise<void>;
}

export type AnalyserFactory = (stream: MediaStream) => StreamAnalyser | undefined;

/** Web Audio graph `stream → analyser` (not connected to the speakers, so no echo). Undefined if Web Audio is unavailable. */
export const createBrowserAnalyser: AnalyserFactory = (stream) => {
  const Context =
    globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return undefined;
  try {
    const context = new Context();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    // Safari starts contexts suspended; we are inside the user's gesture here.
    void context.resume().catch(() => undefined);
    return {
      analyser,
      close: async () => {
        source.disconnect();
        await context.close();
      },
    };
  } catch {
    return undefined;
  }
};
