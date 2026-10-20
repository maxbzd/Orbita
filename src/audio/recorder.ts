import { audioRepo, capturesRepo } from '../db';
import { newId } from '../domain/ids';
import type { CaptureContext, ID } from '../domain/types';
import { Emitter } from './emitter';
import { LevelMeter, browserFrameScheduler, createBrowserAnalyser } from './level';
import type { AnalyserFactory, FrameScheduler, LevelSource, StreamAnalyser } from './level';
import { recordingLocks } from './locks';
import type { RecordingLocks } from './locks';
import { pickRecordingMime } from './mime';
import { MicrophoneError, requestMicrophone } from './permissions';
import { ScreenWakeLock } from './wake-lock';
import { t } from '../i18n';

/** A chunk reaches IndexedDB at least this often, so a crash loses at most this much speech. */
export const DEFAULT_TIMESLICE_MS = 10_000;
/** Mono speech in Opus/AAC: clear enough for transcription, about 14 MB per hour. */
const AUDIO_BITS_PER_SECOND = 32_000;
const TICK_MS = 250;
const FALLBACK_MIME = 'audio/webm';

export type RecorderState =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'stopping'
  /** Saved: the result is in the `finish` event and the return value of `stop()`. */
  | 'finished'
  /** Discarded by the user, or nothing was recorded. */
  | 'cancelled'
  | 'failed';

export type RecorderErrorCode = 'storage' | 'interrupted' | 'media';

const RECORDER_MESSAGES: Readonly<Record<RecorderErrorCode, string>> = {
  get storage() { return t('Could not save the recording on this device. Check the free space.') },
  get interrupted() { return t('The recording was interrupted: the microphone was disconnected. Everything that was recorded has been saved.') },
  get media() { return t('Could not record audio. Please try again.') },
};

export class RecorderError extends Error {
  constructor(
    readonly code: RecorderErrorCode,
    /** Fatal: the recording cannot go on. Otherwise it continues and the error is a warning. */
    readonly fatal: boolean,
    message: string = RECORDER_MESSAGES[code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RecorderError';
  }
}

/** The slice of `MediaRecorder` the recorder uses. */
export interface MediaRecorderLike {
  readonly state: 'inactive' | 'recording' | 'paused';
  readonly mimeType: string;
  start(timeslice?: number): void;
  stop(): void;
  pause(): void;
  resume(): void;
  requestData(): void;
  addEventListener(type: 'dataavailable' | 'stop' | 'error', listener: (event: Event) => void): void;
  removeEventListener(type: 'dataavailable' | 'stop' | 'error', listener: (event: Event) => void): void;
}

/** Everything the recorder takes from the browser, so tests can replace it. */
export interface RecorderDeps {
  getUserMedia(): Promise<MediaStream>;
  pickMime(): string | undefined;
  createMediaRecorder(stream: MediaStream, options: MediaRecorderOptions): MediaRecorderLike;
  createAnalyser: AnalyserFactory;
  scheduler: FrameScheduler;
  wakeLock: Pick<ScreenWakeLock, 'acquire' | 'release'>;
  locks: Pick<RecordingLocks, 'acquire'>;
  /** Monotonic milliseconds. */
  now(): number;
  /** Calls the handler when the page goes to the background or closes; returns the unsubscribe function. */
  onPageHidden(handler: () => void): () => void;
}

function watchPageHidden(handler: () => void): () => void {
  const page = (globalThis as { document?: Document }).document;
  const onVisibility = (): void => {
    if (page?.visibilityState === 'hidden') handler();
  };
  page?.addEventListener('visibilitychange', onVisibility);
  globalThis.addEventListener?.('pagehide', handler);
  return () => {
    page?.removeEventListener('visibilitychange', onVisibility);
    globalThis.removeEventListener?.('pagehide', handler);
  };
}

export function browserRecorderDeps(): RecorderDeps {
  return {
    getUserMedia: () => requestMicrophone(),
    pickMime: () => pickRecordingMime(),
    createMediaRecorder: (stream, options) => new MediaRecorder(stream, options),
    createAnalyser: createBrowserAnalyser,
    scheduler: browserFrameScheduler,
    wakeLock: new ScreenWakeLock(),
    locks: recordingLocks,
    now: () => performance.now(),
    onPageHidden: watchPageHidden,
  };
}

export interface RecorderOptions {
  /** Id of the capture the recording belongs to; generated when omitted. */
  captureId?: ID;
  context?: CaptureContext;
  timesliceMs?: number;
  deps?: Partial<RecorderDeps>;
}

export interface RecordingResult {
  captureId: ID;
  audioId: ID;
  mime: string;
  sizeBytes: number;
  durationSec: number;
  /** Number of pieces the recording was written in. */
  chunks: number;
  /** The recording ended by itself (microphone lost, browser stopped it); what was captured is saved. */
  interrupted: boolean;
}

export interface RecorderEvents {
  state: RecorderState;
  /** Every 250 ms while recording, and once when paused or stopped. */
  tick: { elapsedMs: number };
  /** A chunk has been written to IndexedDB. */
  chunk: { seq: number; sizeBytes: number };
  error: RecorderError;
  finish: RecordingResult;
}

/**
 * One voice recording.
 *
 * `start()` asks for the microphone and creates the Capture (`kind: 'voice'`, `status: 'raw'`)
 * right away; every 10 seconds MediaRecorder hands over a chunk that goes straight to IndexedDB
 * (`audioRepo.appendChunk`), so a crash, a closed tab or a dead battery costs seconds, not the
 * recording (`recovery.ts` picks the pieces up on the next start). `stop()` glues the chunks into
 * one Blob, links it to the Capture (`Capture.audioId`) and sets `durationSec`.
 *
 * An instance records once; make a new one for the next recording.
 */
export class Recorder extends Emitter<RecorderEvents> {
  readonly captureId: ID;
  /** Smoothed microphone level for visualization, 0..1. Alive for the whole recording. */
  readonly level: LevelSource;

  private readonly deps: RecorderDeps;
  private readonly meter: LevelMeter;
  private readonly timesliceMs: number;
  private readonly context: CaptureContext | undefined;

  private currentState: RecorderState = 'idle';
  private stream: MediaStream | undefined;
  private media: MediaRecorderLike | undefined;
  private analyser: StreamAnalyser | undefined;
  private mimeType = FALLBACK_MIME;
  private nextSeq = 0;
  /** Chunk writes run one after another, in order. */
  private writes: Promise<void> = Promise.resolve();
  /** Chunks IndexedDB refused: kept in memory and tried again when the recording is sealed. */
  private readonly unsaved = new Map<number, Blob>();
  private elapsedBeforeMs = 0;
  private runningSinceMs: number | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private releaseLock: (() => void) | undefined;
  private unwatchPage: (() => void) | undefined;
  private stopped: Promise<void> = Promise.resolve();
  private markStopped: () => void = () => {};
  private finishing: Promise<RecordingResult | null> | undefined;
  private cancelRequested = false;
  private captureCreated = false;

  constructor({ captureId, context, timesliceMs = DEFAULT_TIMESLICE_MS, deps }: RecorderOptions = {}) {
    super();
    this.captureId = captureId ?? newId();
    this.context = context;
    this.timesliceMs = timesliceMs;
    this.deps = { ...browserRecorderDeps(), ...deps };
    this.meter = new LevelMeter(this.deps.scheduler);
    this.level = this.meter;
  }

  get state(): RecorderState {
    return this.currentState;
  }

  /** Recorded time without pauses. */
  get elapsedMs(): number {
    return this.elapsedBeforeMs + (this.runningSinceMs === undefined ? 0 : this.deps.now() - this.runningSinceMs);
  }

  /** Mime type the audio is recorded in. */
  get mime(): string {
    return this.mimeType;
  }

  /** Asks for the microphone and starts recording. Rejects with `MicrophoneError` (Russian message) if there is no access. */
  async start(): Promise<void> {
    if (this.currentState !== 'idle') throw new Error(t('This recording has already been started'));
    this.setState('starting');
    try {
      // First thing, before any other await: Safari only allows the microphone inside the user's gesture.
      this.stream = await this.deps.getUserMedia();
      this.releaseLock = await this.deps.locks.acquire(this.captureId);
      if (this.cancelRequested) return await this.abortStart('cancelled');

      const mimeType = this.deps.pickMime();
      const media = this.deps.createMediaRecorder(this.stream, {
        ...(mimeType !== undefined && { mimeType }),
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
      this.media = media;
      this.mimeType = media.mimeType || mimeType || FALLBACK_MIME;

      await capturesRepo.create({
        id: this.captureId,
        kind: 'voice',
        text: '',
        status: 'raw',
        ...(this.context !== undefined && { context: this.context }),
      });
      this.captureCreated = true;
      if (this.cancelRequested) return await this.abortStart('cancelled');

      this.stopped = new Promise<void>((resolve) => {
        this.markStopped = resolve;
      });
      media.addEventListener('dataavailable', this.onData);
      media.addEventListener('stop', this.onStop);
      media.addEventListener('error', this.onMediaError);
      for (const track of this.stream.getTracks()) track.addEventListener('ended', this.onTrackEnded);

      media.start(this.timesliceMs);
      this.runningSinceMs = this.deps.now();
      this.startTicker();
      this.startLevel(this.stream);
      void this.deps.wakeLock.acquire();
      this.unwatchPage = this.deps.onPageHidden(this.flush);
      this.setState('recording');
    } catch (error) {
      await this.abortStart('failed');
      if (error instanceof MicrophoneError) throw error;
      throw new RecorderError('media', true, t('Could not start recording. Please try again.'), { cause: error });
    }
  }

  pause(): void {
    if (this.currentState !== 'recording' || !this.media) return;
    // Whatever is buffered would otherwise wait for the next chunk, which only comes after resume().
    this.media.requestData();
    this.media.pause();
    this.freezeClock();
    this.stopTicker();
    this.meter.pause();
    this.emit('tick', { elapsedMs: this.elapsedMs });
    this.setState('paused');
  }

  resume(): void {
    if (this.currentState !== 'paused' || !this.media) return;
    this.media.resume();
    this.runningSinceMs = this.deps.now();
    this.startTicker();
    this.meter.resume();
    this.setState('recording');
  }

  /**
   * Ends the recording and saves it. Resolves with the result, or `null` when nothing was recorded
   * (the empty Capture is removed). If sealing fails the chunks stay in IndexedDB for `recovery.ts`.
   */
  stop(): Promise<RecordingResult | null> {
    if (this.finishing) return this.finishing;
    if (this.currentState !== 'recording' && this.currentState !== 'paused') return Promise.resolve(null);
    this.finishing = this.finish(false);
    return this.finishing;
  }

  /** Throws the recording away: chunks and the empty Capture are deleted. */
  async cancel(): Promise<void> {
    if (this.currentState === 'starting') {
      this.cancelRequested = true;
      return;
    }
    if (this.finishing || (this.currentState !== 'recording' && this.currentState !== 'paused')) return;

    this.setState('stopping');
    this.freezeClock();
    this.stopTicker();
    this.unwatchPage?.();
    await this.haltMedia();
    await this.writes;
    await this.releaseDevices();
    await this.removeRecording();
    this.releaseLock?.();
    this.setState('cancelled');
  }

  // ───────── Internals ─────────

  private setState(state: RecorderState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.emit('state', state);
  }

  private freezeClock(): void {
    if (this.runningSinceMs === undefined) return;
    this.elapsedBeforeMs += this.deps.now() - this.runningSinceMs;
    this.runningSinceMs = undefined;
  }

  private startTicker(): void {
    this.ticker = setInterval(() => this.emit('tick', { elapsedMs: this.elapsedMs }), TICK_MS);
  }

  private stopTicker(): void {
    clearInterval(this.ticker);
    this.ticker = undefined;
  }

  private startLevel(stream: MediaStream): void {
    this.analyser = this.deps.createAnalyser(stream);
    if (this.analyser) this.meter.attach(this.analyser.analyser);
  }

  /** Stops the MediaRecorder and waits until its last data has been handed over. */
  private async haltMedia(): Promise<void> {
    if (this.media && this.media.state !== 'inactive') this.media.stop();
    await this.stopped;
  }

  /** Releases the microphone, the audio graph and the screen lock. */
  private async releaseDevices(): Promise<void> {
    this.meter.detach();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = undefined;
    const analyser = this.analyser;
    this.analyser = undefined;
    await Promise.allSettled([analyser?.close(), this.deps.wakeLock.release()]);
  }

  private async abortStart(outcome: 'failed' | 'cancelled'): Promise<void> {
    await this.releaseDevices();
    await this.removeRecording();
    this.releaseLock?.();
    this.setState(outcome);
  }

  /** Deletes the Capture shell and the chunks. */
  private async removeRecording(): Promise<void> {
    if (!this.captureCreated) return;
    try {
      await capturesRepo.destroy(this.captureId);
    } catch {
      // Cleanup only: a leftover shell is harmless and recovery will find it.
    }
  }

  private readonly onData = (event: Event): void => {
    const data = (event as Event & { data?: Blob }).data;
    if (!data || data.size === 0) return;
    const seq = this.nextSeq++;
    const durationSec = Math.round(this.elapsedMs / 100) / 10;
    this.writes = this.writes.then(() => this.persistChunk(seq, data, durationSec));
  };

  private async persistChunk(seq: number, data: Blob, durationSec: number): Promise<void> {
    try {
      await audioRepo.appendChunk({ captureId: this.captureId, seq, data, mime: this.mimeType });
    } catch (cause) {
      this.unsaved.set(seq, data);
      this.emit('error', new RecorderError('storage', false, undefined, { cause }));
      return;
    }
    this.emit('chunk', { seq, sizeBytes: data.size });
    try {
      // Keeps the length of the recording known even if the tab dies before stop().
      await capturesRepo.update(this.captureId, { durationSec });
    } catch {
      // The Capture was deleted while recording: the chunks are still written.
    }
  }

  /** Hands buffered audio over now: the page may be about to be frozen or closed. */
  private readonly flush = (): void => {
    if (this.currentState === 'recording' && this.media?.state === 'recording') this.media.requestData();
  };

  private readonly onStop = (): void => {
    this.markStopped();
    if (this.currentState !== 'recording' && this.currentState !== 'paused') return;
    // Nobody asked for this stop: the browser or the device ended the recording.
    this.emit('error', new RecorderError('interrupted', true));
    this.finishing = this.finish(true);
    this.finishing.catch(() => undefined);
  };

  private readonly onMediaError = (): void => {
    this.emit('error', new RecorderError('media', false));
  };

  private readonly onTrackEnded = (): void => {
    if (this.media && this.media.state !== 'inactive') this.media.stop();
  };

  private async finish(interrupted: boolean): Promise<RecordingResult | null> {
    this.setState('stopping');
    this.freezeClock();
    this.stopTicker();
    this.unwatchPage?.();
    try {
      await this.haltMedia();
      await this.writes;
      await this.releaseDevices();
      this.emit('tick', { elapsedMs: this.elapsedMs });
      const result = await this.seal(interrupted);
      if (!result) {
        this.setState('cancelled');
        return null;
      }
      this.setState('finished');
      this.emit('finish', result);
      return result;
    } catch (error) {
      const failure =
        error instanceof RecorderError ? error : new RecorderError('storage', true, undefined, { cause: error });
      this.setState('failed');
      this.emit('error', failure);
      throw failure;
    } finally {
      this.releaseLock?.();
    }
  }

  /** Glues the chunks into one audio row linked to the Capture. */
  private async seal(interrupted: boolean): Promise<RecordingResult | null> {
    for (const [seq, data] of this.unsaved) {
      await audioRepo.appendChunk({ captureId: this.captureId, seq, data, mime: this.mimeType });
      this.unsaved.delete(seq);
    }
    const durationSec = Math.round(this.elapsedMs / 100) / 10;
    const audio = await audioRepo.finalizeFromChunks(this.captureId, { mime: this.mimeType });
    if (!audio) {
      await capturesRepo.destroy(this.captureId);
      return null;
    }
    await capturesRepo.update(this.captureId, { durationSec });
    return {
      captureId: this.captureId,
      audioId: audio.id,
      mime: audio.mime,
      sizeBytes: audio.sizeBytes,
      durationSec,
      chunks: audio.chunks ?? this.nextSeq,
      interrupted,
    };
  }
}
