import { create } from 'zustand';
import { LiveDictation, MicrophoneError, Recorder } from '../audio';
import type { DictationTranscript, LevelSource, LiveDictationOptions, RecorderEvents, RecordingResult } from '../audio';
import { capturesRepo, settingsRepo } from '../db';
import type { CaptureContext, ID, Settings } from '../domain/types';
import { processing } from './processing';
import type { ProcessingService } from './processing';
import { t, msg } from '../i18n';

/**
 * The recording service: one state machine for "голос → запись → обработка → разбор" that outlives any
 * screen. The recording screen, the mini recorder, the dock and the navigation sphere all read the same
 * store, so leaving the screen never touches the recording.
 *
 *   idle ──start──▶ recording ⇄ paused ──done──▶ processing ──(objects found)──▶ review ──▶ idle
 *                       └────────────────cancel───────────────────────────────────────────▶ idle
 *
 * Two promises the service keeps (docs/SPEC.md §2): "Готово" saves at once, whatever the network does
 * (the Capture exists from the first second, chunks go to IndexedDB every 10 s, the text is written before
 * any request), and the recording starts inside the user's gesture (`start()` reaches `getUserMedia`
 * without awaiting anything first).
 */

export type RecorderPhase = 'idle' | 'recording' | 'paused' | 'processing' | 'review';

/** A longer recording is not thrown away by ✕: it is moved to the trash with an "Вернуть" toast (§3.4). */
export const UNDO_THRESHOLD_MS = 5_000;

/** The slice of `Recorder` the service uses; tests pass a fake. */
export type RecorderLike = Pick<Recorder, 'captureId' | 'state' | 'elapsedMs' | 'level' | 'start' | 'pause' | 'resume' | 'stop' | 'cancel' | 'on'>;
/** The slice of `LiveDictation` the service uses. */
export type DictationLike = Pick<LiveDictation, 'start' | 'stop' | 'on' | 'transcript'>;

export type DictationStatus = 'unsupported' | 'idle' | 'listening' | 'failed';

export interface MicProblem {
  code: string;
  message: string;
}

export interface RecorderStoreState {
  phase: RecorderPhase;
  /** Between the tap and the microphone's answer. The screen already shows the recording. */
  starting: boolean;
  /** The capture of the current recording; after "Готово" the one being processed or reviewed. */
  captureId: ID | null;
  elapsedMs: number;
  transcript: DictationTranscript;
  dictation: DictationStatus;
  micProblem: MicProblem | null;
  /** A non-fatal warning from the recorder or dictation, shown once ("Запись прервалась…"). */
  notice: string | null;
  context: CaptureContext | null;
  projectIds: ID[];
}

const EMPTY_TRANSCRIPT: DictationTranscript = { final: '', interim: '' };

const initialState = (): RecorderStoreState => ({
  phase: 'idle',
  starting: false,
  captureId: null,
  elapsedMs: 0,
  transcript: EMPTY_TRANSCRIPT,
  dictation: 'idle',
  micProblem: null,
  notice: null,
  context: null,
  projectIds: [],
});

/** What ✕ did. */
export type CancelOutcome =
  | { kind: 'nothing' }
  | { kind: 'discarded' }
  /** The recording is in the trash; `undo()` brings it back as a saved capture and returns its id. */
  | { kind: 'undoable'; captureId: ID; undo(): Promise<ID> };

export interface StartOptions {
  context?: CaptureContext;
}

export interface RecorderServiceDeps {
  createRecorder(options: { context?: CaptureContext }): RecorderLike;
  /** Undefined where there is no browser dictation. */
  createDictation(options: LiveDictationOptions): DictationLike | undefined;
  /** Defaults to the stored settings. */
  loadSettings(): Promise<Settings>;
  /** Called once the capture is saved with its text; starts the background processing. */
  process(captureId: ID): void;
  /** The processing service the machine follows (its jobs move `processing` on to `review`). */
  jobs: Pick<ProcessingService, 'markSaving' | 'forget' | 'onSettled'>;
  vibrate(ms: number): void;
  /** Lock-screen controls. Returns the function that removes them. */
  attachMediaSession(handlers: MediaSessionHandlers): () => void;
}

export interface MediaSessionHandlers {
  play(): void;
  pause(): void;
  stop(): void;
}

function attachBrowserMediaSession({ play, pause, stop }: MediaSessionHandlers): () => void {
  const session = (globalThis as { navigator?: Navigator }).navigator?.mediaSession;
  if (!session) return () => undefined;
  const actions: MediaSessionAction[] = ['play', 'pause', 'stop'];
  try {
    session.metadata = new MediaMetadata({ title: t('Recording'), artist: t('Orbita') });
    session.setActionHandler('play', play);
    session.setActionHandler('pause', pause);
    session.setActionHandler('stop', stop);
  } catch {
    // Older browsers know the object but not every action.
  }
  return () => {
    for (const action of actions) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // Nothing to clean up.
      }
    }
    session.metadata = null;
  };
}

export const browserRecorderServiceDeps: RecorderServiceDeps = {
  createRecorder: (options) => new Recorder(options),
  createDictation: (options) => (LiveDictation.isSupported() ? new LiveDictation(options) : undefined),
  loadSettings: () => settingsRepo.getSettings(),
  process: (captureId) => void processing.enqueue(captureId),
  jobs: processing,
  vibrate: (ms) => {
    try {
      const nav = (globalThis as { navigator?: Navigator }).navigator;
      // Chrome refuses (and logs an error) before the first tap, e.g. when the PWA shortcut starts a recording.
      if (nav?.userActivation && !nav.userActivation.hasBeenActive) return;
      nav?.vibrate?.(ms);
    } catch {
      // iOS has no vibration; the screen flashes the ring instead.
    }
  },
  attachMediaSession: attachBrowserMediaSession,
};

/** `ru` → `ru-RU`: the Web Speech API wants a region. */
export function dictationLanguage(lang: string): string {
  const trimmed = lang.trim();
  if (trimmed.includes('-')) return trimmed;
  return { ru: 'ru-RU', en: 'en-US', uk: 'uk-UA', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', pt: 'pt-BR' }[trimmed.toLowerCase()] ?? (trimmed || 'ru-RU');
}

/** A stable level source for the orb: it forwards the current recorder's meter and survives recorder changes. */
class LevelHub implements LevelSource {
  private readonly listeners = new Set<(level: number) => void>();
  private current = 0;
  private detach: (() => void) | undefined;

  get value(): number {
    return this.current;
  }

  subscribe(listener: (level: number) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  attach(source: LevelSource | undefined): void {
    this.detach?.();
    this.detach = undefined;
    this.push(0);
    if (source) this.detach = source.subscribe((level) => this.push(level));
  }

  private push(level: number): void {
    this.current = level;
    for (const listener of [...this.listeners]) listener(level);
  }
}

export interface RecorderService {
  readonly store: ReturnType<typeof createRecorderStore>;
  /** Microphone level of the current recording, 0..1, for `useOrbLevel`. */
  readonly level: LevelSource;
  /**
   * Starts a voice recording. Call it straight from the tap handler: nothing is awaited before the
   * microphone is requested. Resolves true when recording runs (a second tap while the microphone is
   * still answering gets the same answer), false when it could not start (`micProblem` says why) or
   * a recording was already running.
   */
  start(options?: StartOptions): Promise<boolean>;
  pause(): void;
  resume(): void;
  /**
   * "Готово": seals the recording, writes the text, and hands the capture to the background processing.
   * `text` replaces the dictated text (the author edited it). Resolves with the capture id, or null if
   * nothing was recorded.
   */
  done(options?: { text?: string }): Promise<ID | null>;
  /** ✕. Recordings over five seconds go to the trash and can be brought back. */
  cancel(): Promise<CancelOutcome>;
  /** Saves typed text as a capture and hands it to the processing. */
  saveText(text: string, options?: { context?: CaptureContext; projectIds?: ID[] }): Promise<ID>;
  /** Context (walk, home…) of the current recording. */
  setContext(context: CaptureContext | null): void;
  setProjects(projectIds: ID[]): void;
  /** Leaves `processing` / `review` for `idle` (the review screen is closed). */
  dismissReview(captureId?: ID): void;
  clearNotice(): void;
  clearMicProblem(): void;
  /** Back to a clean slate; tests and sign-out. */
  reset(): void;
}

function createRecorderStore() {
  return create<RecorderStoreState>(() => initialState());
}

const isFree = (phase: RecorderPhase): boolean => phase === 'idle' || phase === 'processing' || phase === 'review';

const DICTATED_NOTE = msg('Live dictation stopped. The recording continues, and the text will appear after processing.');

export function createRecorderService(deps: RecorderServiceDeps = browserRecorderServiceDeps): RecorderService {
  const store = createRecorderStore();
  const hub = new LevelHub();
  const set = store.setState;
  const get = store.getState;

  let recorder: RecorderLike | undefined;
  let dictation: DictationLike | undefined;
  let startPromise: Promise<boolean> | undefined;
  let detach: Array<() => void> = [];
  let detachMediaSession: (() => void) | undefined;
  /** Settings are read in the background; a recording never waits for them. */
  let settings: Settings | undefined;
  let finishing: Promise<ID | null> | undefined;
  /** The service itself is ending the recording (done, cancel): the recorder's own `finish` event is not news. */
  let ending = false;

  const refreshSettings = (): void => {
    void deps
      .loadSettings()
      .then((loaded) => {
        settings = loaded;
      })
      .catch(() => undefined);
  };
  refreshSettings();

  const cleanup = (): void => {
    for (const off of detach) off();
    detach = [];
    detachMediaSession?.();
    detachMediaSession = undefined;
    hub.attach(undefined);
    recorder = undefined;
    dictation = undefined;
    startPromise = undefined;
    finishing = undefined;
    ending = false;
  };

  const markSettledForCurrent = (captureId: ID, outcome: 'review' | 'idle'): void => {
    const state = get();
    if (state.captureId !== captureId || state.phase !== 'processing') return;
    set({ phase: outcome });
  };

  // When the pipeline reports a result for the capture the user just recorded, the machine moves on.
  deps.jobs.onSettled(({ captureId, job }) => {
    if (job.stage === 'done' && job.result) markSettledForCurrent(captureId, job.result.outcome === 'review' ? 'review' : 'idle');
    else if (job.stage === 'waiting' || job.stage === 'failed') markSettledForCurrent(captureId, 'idle');
  });

  /** Writes what is known into the capture: the dictated text first, so a failure later loses nothing. */
  async function saveText(captureId: ID, text: string, rawText: string | undefined): Promise<void> {
    const clean = text.trim();
    if (clean === '') return;
    await capturesRepo.update(captureId, { text: clean, ...(rawText !== undefined && rawText.trim() !== '' && { rawText: rawText.trim() }), status: 'transcribed' });
  }

  async function seal(
    active: RecorderLike,
    activeDictation: DictationLike | undefined,
    override: string | undefined,
    interrupted?: RecordingResult,
  ): Promise<ID | null> {
    const captureId = active.captureId;
    deps.jobs.markSaving(captureId);
    try {
      const [dictated, result] = await Promise.all([
        activeDictation ? activeDictation.stop().catch(() => '') : Promise.resolve(''),
        interrupted ? Promise.resolve(interrupted) : active.stop(),
      ]);
      if (!result) {
        deps.jobs.forget(captureId);
        set({ ...initialState() });
        cleanup();
        return null;
      }
      const spoken = override ?? dictated;
      await saveText(captureId, spoken, dictated);
      deps.vibrate(8);
      cleanup();
      deps.process(captureId);
      return captureId;
    } catch (error) {
      cleanup();
      set({ phase: 'idle', notice: error instanceof Error ? error.message : t('Could not save the record') });
      return null;
    }
  }

  function wire(active: RecorderLike, activeDictation: DictationLike | undefined): void {
    detach.push(
      active.on('tick', ({ elapsedMs }) => set({ elapsedMs })),
      active.on('state', (state) => {
        if (get().phase === 'processing') return;
        if (state === 'recording') set({ phase: 'recording', starting: false });
        else if (state === 'paused') set({ phase: 'paused' });
      }),
      active.on('error', (error) => {
        // A fatal error ends the recording by itself; `finish` follows with what was saved.
        set({ notice: error.message });
      }),
      active.on('finish', (result) => {
        // The recorder ended on its own (microphone lost, browser stopped it): save what there is.
        if (ending || finishing || recorder !== active) return;
        ending = true;
        finishing = seal(active, activeDictation, undefined, result);
        set({ phase: 'processing' });
      }),
    );
    if (activeDictation) {
      detach.push(
        activeDictation.on('transcript', (transcript) => set({ transcript })),
        activeDictation.on('state', (state) => {
          if (state === 'listening') set({ dictation: 'listening' });
        }),
        activeDictation.on('error', (error) => set({ dictation: 'failed', notice: error.message || t(DICTATED_NOTE) })),
      );
    }
  }

  const service: RecorderService = {
    store,
    level: hub,

    start(options = {}) {
      const state = get();
      if (state.starting) return startPromise ?? Promise.resolve(false);
      if (state.phase === 'recording' || state.phase === 'paused') return Promise.resolve(false);

      const context = options.context ?? settings?.capture.defaultContext ?? undefined;
      const active = deps.createRecorder({ ...(context !== undefined && { context }) });
      const activeDictation = deps.createDictation({ lang: dictationLanguage(settings?.stt.language ?? 'ru') });
      recorder = active;
      dictation = activeDictation;
      finishing = undefined;
      ending = false;
      hub.attach(active.level);
      wire(active, activeDictation);

      set({
        ...initialState(),
        phase: 'recording',
        starting: true,
        captureId: active.captureId,
        context: context ?? null,
        dictation: activeDictation ? 'idle' : 'unsupported',
      });

      // Both calls happen inside the user's gesture: no await before them.
      const started = active.start();
      activeDictation?.start();
      deps.vibrate(8);

      const promise = started.then(
        () => {
          if (recorder !== active) return false;
          set({ starting: false });
          detachMediaSession = deps.attachMediaSession({
            play: () => service.resume(),
            pause: () => service.pause(),
            stop: () => void service.done(),
          });
          refreshSettings();
          return true;
        },
        (error: unknown) => {
          if (recorder !== active) return false;
          const problem: MicProblem =
            error instanceof MicrophoneError
              ? { code: error.code, message: error.message }
              : { code: 'media', message: error instanceof Error ? error.message : t('Could not start recording. Please try again.') };
          void activeDictation?.stop().catch(() => undefined);
          cleanup();
          set({ ...initialState(), micProblem: problem });
          return false;
        },
      );
      startPromise = promise;
      return promise;
    },

    pause() {
      if (get().phase !== 'recording' || !recorder) return;
      recorder.pause();
      // Speech while paused must not end up in the text.
      void dictation?.stop().catch(() => undefined);
    },

    resume() {
      if (get().phase !== 'paused' || !recorder) return;
      recorder.resume();
      dictation?.start();
      deps.vibrate(8);
    },

    async done(options = {}) {
      const state = get();
      const active = recorder;
      if ((state.phase !== 'recording' && state.phase !== 'paused') || !active) return null;
      if (finishing) return finishing;
      if (startPromise && state.starting && !(await startPromise)) return null;
      if (finishing) return finishing;
      ending = true;
      set({ phase: 'processing' });
      finishing = seal(active, dictation, options.text);
      return finishing;
    },

    async cancel() {
      const state = get();
      const active = recorder;
      if ((state.phase !== 'recording' && state.phase !== 'paused') || !active) return { kind: 'nothing' };
      const captureId = active.captureId;
      const long = active.elapsedMs > UNDO_THRESHOLD_MS;
      const activeDictation = dictation;
      ending = true;

      if (!long) {
        void activeDictation?.stop().catch(() => undefined);
        await active.cancel();
        cleanup();
        set({ ...initialState() });
        return { kind: 'discarded' };
      }

      // Seal it like "Готово" but keep it out of sight: the toast can bring it back for five seconds.
      set({ phase: 'idle' });
      finishing = undefined;
      const dictated = await (activeDictation?.stop().catch(() => '') ?? Promise.resolve(''));
      const result = await active.stop().catch(() => null);
      cleanup();
      set({ ...initialState() });
      if (!result) return { kind: 'discarded' };
      await saveText(captureId, dictated, dictated);
      await capturesRepo.remove(captureId);
      return {
        kind: 'undoable',
        captureId,
        undo: async () => {
          await capturesRepo.restore(captureId);
          deps.jobs.markSaving(captureId);
          if (isFree(get().phase)) set({ ...initialState(), phase: 'processing', captureId });
          deps.process(captureId);
          return captureId;
        },
      };
    },

    async saveText(text, options = {}) {
      const clean = text.trim();
      if (clean === '') throw new RangeError(t('Empty text is not saved'));
      const context = options.context ?? settings?.capture.defaultContext ?? undefined;
      const capture = await capturesRepo.create({
        kind: 'text',
        text: clean,
        status: 'transcribed',
        ...(context !== undefined && { context }),
        ...(options.projectIds !== undefined && { projectIds: options.projectIds }),
      });
      deps.jobs.markSaving(capture.id);
      // A recording in progress keeps the machine; only an idle one follows the new capture.
      if (isFree(get().phase)) set({ ...initialState(), phase: 'processing', captureId: capture.id });
      deps.process(capture.id);
      return capture.id;
    },

    setContext(context) {
      set({ context });
      const id = get().captureId;
      if (id && recorder && context) void capturesRepo.update(id, { context }).catch(() => undefined);
    },

    setProjects(projectIds) {
      set({ projectIds });
      const id = get().captureId;
      if (id && recorder) void capturesRepo.update(id, { projectIds }).catch(() => undefined);
    },

    dismissReview(captureId) {
      const state = get();
      if (state.phase !== 'processing' && state.phase !== 'review') return;
      if (captureId !== undefined && state.captureId !== captureId) return;
      set({ phase: 'idle' });
    },

    clearNotice: () => set({ notice: null }),
    clearMicProblem: () => set({ micProblem: null }),

    reset() {
      cleanup();
      set({ ...initialState() });
    },
  };
  return service;
}

/** The app's recording service. */
export const recorderService: RecorderService = createRecorderService();

// ───────── Hooks ─────────

/** The recorder state; pass a selector to subscribe to a slice only. */
export function useRecorder(): RecorderStoreState;
export function useRecorder<T>(selector: (state: RecorderStoreState) => T): T;
export function useRecorder<T>(selector?: (state: RecorderStoreState) => T): T | RecorderStoreState {
  return recorderService.store(selector ?? ((state) => state as unknown as T));
}

/** True while a recording runs or is paused: the mini recorder, the dock and the sphere follow it. */
export const selectIsRecording = (state: RecorderStoreState): boolean => state.phase === 'recording' || state.phase === 'paused';

export type { RecorderEvents };
