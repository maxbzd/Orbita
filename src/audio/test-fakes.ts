import type { AnalyserFactory, AnalyserLike, FrameScheduler } from './level';
import type { LockManagerLike } from './locks';
import type { MediaRecorderLike, RecorderDeps } from './recorder';
import type { SpeechErrorEventLike, SpeechRecognitionLike, SpeechResultEventLike } from './live-dictation';
import type { VisibilityTarget, WakeLockApi, WakeLockSentinelLike } from './wake-lock';

/** Stand-ins for browser APIs that jsdom does not have; shared by the audio tests. */

export class FakeTrack extends EventTarget {
  stopped = false;
  stop(): void {
    this.stopped = true;
  }
  /** The device went away (unplugged microphone, incoming call). */
  end(): void {
    this.dispatchEvent(new Event('ended'));
  }
}

export class FakeStream {
  readonly track = new FakeTrack();
  getTracks(): MediaStreamTrack[] {
    return [this.track as unknown as MediaStreamTrack];
  }
  asMediaStream(): MediaStream {
    return this as unknown as MediaStream;
  }
}

/** Delivers events asynchronously and in the real order: the last `dataavailable`, then `stop`. */
export class FakeMediaRecorder extends EventTarget implements MediaRecorderLike {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  timeslice: number | undefined;
  requestDataCalls = 0;
  private buffered: Blob[] = [];

  constructor(
    readonly mimeType: string,
    readonly options: MediaRecorderOptions,
  ) {
    super();
  }

  start(timeslice?: number): void {
    this.state = 'recording';
    this.timeslice = timeslice;
  }

  /** Audio captured since the last chunk: it leaves the recorder with the next `deliver`, `requestData` or `stop`. */
  capture(text: string): void {
    this.buffered.push(new Blob([text], { type: this.mimeType }));
  }

  /** A timeslice elapsed: the browser hands over what it has (nothing is dropped if called with text). */
  deliver(text?: string): void {
    if (text !== undefined) this.capture(text);
    this.flush();
  }

  requestData(): void {
    this.requestDataCalls += 1;
    queueMicrotask(() => this.flush());
  }

  pause(): void {
    this.state = 'paused';
  }

  resume(): void {
    this.state = 'recording';
  }

  stop(): void {
    this.state = 'inactive';
    queueMicrotask(() => {
      this.flush();
      this.dispatchEvent(new Event('stop'));
    });
  }

  fail(): void {
    this.dispatchEvent(new Event('error'));
  }

  private flush(): void {
    const data = new Blob(this.buffered, { type: this.mimeType });
    this.buffered = [];
    this.dispatchEvent(Object.assign(new Event('dataavailable'), { data }));
  }
}

export class FakeAnalyser implements AnalyserLike {
  readonly fftSize = 256;
  private amplitude = 0;
  setAmplitude(amplitude: number): void {
    this.amplitude = amplitude;
  }
  getFloatTimeDomainData(array: Float32Array<ArrayBuffer>): void {
    array.fill(this.amplitude);
  }
}

/** Animation frames that run when the test says so. */
export class ManualScheduler implements FrameScheduler {
  private callbacks = new Map<number, (timeMs: number) => void>();
  private nextHandle = 1;

  get pending(): number {
    return this.callbacks.size;
  }

  request(callback: (timeMs: number) => void): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  /** Runs the frame that is waiting, as if the browser painted at `timeMs`. */
  step(timeMs: number): void {
    const [handle, callback] = [...this.callbacks][0] ?? [];
    if (handle === undefined || !callback) return;
    this.callbacks.delete(handle);
    callback(timeMs);
  }
}

/** `navigator.locks` with exclusive locks and `ifAvailable`. */
export class FakeLockManager implements LockManagerLike {
  readonly held = new Set<string>();

  async request(name: string, _options: { ifAvailable: boolean }, callback: (lock: object | null) => unknown): Promise<unknown> {
    if (this.held.has(name)) return callback(null);
    this.held.add(name);
    try {
      return await callback({ name });
    } finally {
      this.held.delete(name);
    }
  }
}

export class FakeWakeLock {
  acquired = 0;
  released = 0;
  acquire(): Promise<boolean> {
    this.acquired += 1;
    return Promise.resolve(true);
  }
  release(): Promise<void> {
    this.released += 1;
    return Promise.resolve();
  }
}

/** The Screen Wake Lock API: records requests and sentinels, can refuse. */
export class FakeWakeLockApi implements WakeLockApi {
  requests = 0;
  sentinels: { released: boolean }[] = [];
  refuse = false;

  async request(): Promise<WakeLockSentinelLike> {
    this.requests += 1;
    if (this.refuse) throw new DOMException('denied', 'NotAllowedError');
    const sentinel = { released: false };
    this.sentinels.push(sentinel);
    return {
      release: async () => {
        sentinel.released = true;
      },
    };
  }
}

export class FakePage extends EventTarget implements VisibilityTarget {
  visibilityState = 'visible';
  override addEventListener(type: 'visibilitychange', listener: () => void): void {
    super.addEventListener(type, listener);
  }
  override removeEventListener(type: 'visibilitychange', listener: () => void): void {
    super.removeEventListener(type, listener);
  }
  show(): void {
    this.visibilityState = 'visible';
    this.dispatchEvent(new Event('visibilitychange'));
  }
  hide(): void {
    this.visibilityState = 'hidden';
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

/** Everything a `Recorder` needs, faked, with handles to poke at it from a test. */
export function createRecorderHarness(overrides: Partial<RecorderDeps> = {}) {
  const harness = {
    stream: new FakeStream(),
    media: undefined as FakeMediaRecorder | undefined,
    analyser: new FakeAnalyser(),
    analyserClosed: false,
    scheduler: new ManualScheduler(),
    wakeLock: new FakeWakeLock(),
    clockMs: 0,
    hidePage: () => {},
    mimeType: 'audio/webm;codecs=opus' as string | undefined,
    deps: undefined as unknown as Partial<RecorderDeps>,
  };
  const createAnalyser: AnalyserFactory = () => ({
    analyser: harness.analyser,
    close: async () => {
      harness.analyserClosed = true;
    },
  });
  harness.deps = {
    getUserMedia: async () => harness.stream.asMediaStream(),
    pickMime: () => harness.mimeType,
    createMediaRecorder: (_stream, options) => {
      harness.media = new FakeMediaRecorder(options.mimeType ?? 'audio/webm', options);
      return harness.media;
    },
    createAnalyser,
    scheduler: harness.scheduler,
    wakeLock: harness.wakeLock,
    now: () => harness.clockMs,
    onPageHidden: (handler) => {
      harness.hidePage = handler;
      return () => {
        harness.hidePage = () => {};
      };
    },
    ...overrides,
  };
  return harness;
}

/** A speech recognizer that tests drive by hand. */
export class FakeRecognition implements SpeechRecognitionLike {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((event: SpeechResultEventLike) => void) | null = null;
  onerror: ((event: SpeechErrorEventLike) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;
  stopCalls = 0;
  /** Set to make `stop()` do nothing, like a browser that never ends the session. */
  ignoreStop = false;

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.stopCalls += 1;
    if (!this.ignoreStop) queueMicrotask(() => this.onend?.());
  }

  abort(): void {
    this.onend?.();
  }

  /** `results` as the browser reports them: `[text, isFinal]` pairs; `resultIndex` is where the news start. */
  say(results: [text: string, isFinal: boolean][], resultIndex = 0): void {
    this.onresult?.({
      resultIndex,
      results: Object.assign(
        results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })),
        {},
      ),
    });
  }

  fail(error: string): void {
    this.onerror?.({ error });
  }

  end(): void {
    this.onend?.();
  }
}
