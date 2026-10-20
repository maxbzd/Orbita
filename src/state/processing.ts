import { create } from 'zustand';
import {
  AbortedError,
  NoKeyError,
  OfflineError,
  checkAiReadiness,
  createLlmProvider,
  createSttProvider,
  isAiError,
  isMockAiBuild,
  processCapture,
  sharedManualProvider,
} from '../ai';
import type { AiErrorCode, LlmProvider, ProcessDeps, ProcessResult, SttProvider } from '../ai';
import { audioRepo, capturesRepo, settingsRepo } from '../db';
import type { ID, Settings } from '../domain/types';
import { t } from '../i18n';

/**
 * Background processing of saved captures: transcribe → extract → resolve → review. It is the only
 * place the capture flow talks to `src/ai`. Saving never waits for it and never depends on it: a capture
 * without a key, without a network or without a recognizer simply waits (`waiting`), with the reason.
 *
 * One job per capture, in a small store so screens can show what is going on and offer the next step.
 */

/**
 * - `saving`   the recording is being sealed (a moment after "Готово");
 * - `running`  the pipeline works (the capture's own status says whether it transcribes or extracts);
 * - `waiting`  nothing to do until the user or the world changes (`waiting` says what);
 * - `done`     `result` is there;
 * - `failed`   `error` is a ready Russian sentence for the "Повторить" button.
 */
export type JobStage = 'saving' | 'running' | 'waiting' | 'done' | 'failed';

/**
 * - `no-key`        no API key for the chosen provider (clipboard mode is the way out);
 * - `no-transcript` a recording with no text and no recognizer that can read a finished recording;
 * - `offline`       no network, retried when it returns;
 * - `cancelled`     the user gave up on the clipboard step.
 */
export type WaitingReason = 'no-key' | 'no-transcript' | 'offline' | 'cancelled';

export interface Job {
  captureId: ID;
  stage: JobStage;
  /** `manual`: the clipboard provider (the user pastes the model's answer). */
  mode: 'auto' | 'manual';
  startedAt: number;
  waiting?: WaitingReason;
  /** Ready-to-show sentence: why the job waits or failed. */
  message?: string;
  errorCode?: AiErrorCode;
  retryable?: boolean;
  result?: ProcessResult;
}

export interface ProcessingDeps {
  getSettings(): Promise<Settings>;
  hasAudio(captureId: ID): Promise<boolean>;
  /** Text of the capture, or undefined when it does not exist. */
  textOf(captureId: ID): Promise<string | undefined>;
  createLlm(settings: Settings, manual: boolean): LlmProvider;
  createStt(settings: Settings): SttProvider;
  /** Whether a finished recording can be turned into text with these settings. */
  canTranscribe(settings: Settings): boolean;
  readiness(settings: Settings): { ready: boolean; reason?: string };
  run(captureId: ID, deps: ProcessDeps): Promise<ProcessResult>;
  now(): number;
}

export const browserProcessingDeps: ProcessingDeps = {
  getSettings: () => settingsRepo.getSettings(),
  hasAudio: async (captureId) => (await audioRepo.getForCapture(captureId)) !== undefined,
  textOf: async (captureId) => (await capturesRepo.get(captureId))?.text,
  createLlm: (settings, manual) => (manual ? sharedManualProvider : createLlmProvider(settings)),
  createStt: (settings) => createSttProvider(settings),
  canTranscribe: (settings) => isMockAiBuild() || settings.stt.provider !== 'browser',
  readiness: (settings) => checkAiReadiness(settings),
  run: processCapture,
  now: () => Date.now(),
};

interface JobsState {
  jobs: Readonly<Record<ID, Job>>;
}

export interface SettledEvent {
  captureId: ID;
  job: Job;
}

export interface ProcessingService {
  readonly store: ReturnType<typeof createJobsStore>;
  getJob(captureId: ID): Job | undefined;
  /** The capture is being sealed; processing starts with `enqueue` once its text is saved. */
  markSaving(captureId: ID): void;
  /** Starts (or restarts) processing. Resolves when the job has settled; never rejects. */
  enqueue(captureId: ID, options?: { manual?: boolean }): Promise<Job>;
  /** Gives up on a running or waiting job (the clipboard step). */
  cancel(captureId: ID): void;
  /** Forgets a job (the screen that showed it is gone). */
  forget(captureId: ID): void;
  /** Called after each job reaches `done`, `failed` or `waiting`. Returns the unsubscribe function. */
  onSettled(listener: (event: SettledEvent) => void): () => void;
  /** Restarts what was waiting for the network. Wire to the `online` event. */
  retryOffline(): void;
}

function createJobsStore() {
  return create<JobsState>(() => ({ jobs: {} }));
}

export function createProcessing(deps: ProcessingDeps = browserProcessingDeps): ProcessingService {
  const store = createJobsStore();
  const controllers = new Map<ID, AbortController>();
  const listeners = new Set<(event: SettledEvent) => void>();

  const put = (captureId: ID, patch: Partial<Job> & Pick<Job, 'stage'>): Job => {
    const previous = store.getState().jobs[captureId];
    // A new stage starts clean: old messages and results do not leak into it.
    const next: Job = {
      mode: patch.mode ?? previous?.mode ?? 'auto',
      startedAt: patch.startedAt ?? previous?.startedAt ?? deps.now(),
      ...patch,
      captureId,
    };
    store.setState((state) => ({ jobs: { ...state.jobs, [captureId]: next } }));
    return next;
  };

  const settle = (job: Job): Job => {
    for (const listener of [...listeners]) {
      try {
        listener({ captureId: job.captureId, job });
      } catch {
        // A broken listener must not break processing.
      }
    }
    return job;
  };

  const waiting = (captureId: ID, mode: Job['mode'], reason: WaitingReason, message: string, extra: Partial<Job> = {}): Job =>
    settle(put(captureId, { stage: 'waiting', mode, waiting: reason, message, ...extra }));

  async function run(captureId: ID, manualRequested: boolean): Promise<Job> {
    const settings = await deps.getSettings();
    const manual = manualRequested || settings.ai.provider === 'manual';
    const mode: Job['mode'] = manual ? 'manual' : 'auto';

    const text = await deps.textOf(captureId);
    if (text === undefined) {
      return settle(put(captureId, { stage: 'failed', mode, message: t('Record not found. It may be in the trash.'), retryable: false }));
    }

    if (!manual) {
      const readiness = deps.readiness(settings);
      if (!readiness.ready) {
        return waiting(captureId, mode, 'no-key', readiness.reason ?? new NoKeyError().message);
      }
    }
    if (text.trim() === '' && (await deps.hasAudio(captureId)) && !deps.canTranscribe(settings)) {
      return waiting(
        captureId,
        mode,
        'no-transcript',
        t('The record is saved but has no text yet: recognition of a ready recording is not enabled. Type the text yourself or turn it on in Settings → Speech.'),
      );
    }

    const controller = new AbortController();
    controllers.set(captureId, controller);
    put(captureId, { stage: 'running', mode, startedAt: deps.now() });
    try {
      const result = await deps.run(captureId, {
        llm: deps.createLlm(settings, manual),
        stt: deps.createStt(settings),
        settings,
        signal: controller.signal,
      });
      return settle(put(captureId, { stage: 'done', mode, result }));
    } catch (error) {
      if (error instanceof AbortedError) {
        return waiting(captureId, mode, 'cancelled', t('Processing stopped. The record is saved and waiting.'));
      }
      if (error instanceof NoKeyError) return waiting(captureId, mode, 'no-key', error.message);
      if (error instanceof OfflineError) {
        return waiting(captureId, mode, 'offline', t('No network. The record is saved, I will process it when the network is back.'), { errorCode: 'offline', retryable: true });
      }
      const message = isAiError(error) ? error.message : error instanceof Error && error.message ? t('Could not process the record: {message}', { message: error.message }) : t('Could not process the recording');
      return settle(put(captureId, { stage: 'failed', mode, message, errorCode: isAiError(error) ? error.code : undefined, retryable: true }));
    } finally {
      controllers.delete(captureId);
    }
  }

  const inFlight = new Map<ID, Promise<Job>>();

  const service: ProcessingService = {
    store,
    getJob: (captureId) => store.getState().jobs[captureId],
    markSaving(captureId) {
      put(captureId, { stage: 'saving' });
    },
    enqueue(captureId, { manual = false } = {}) {
      const active = inFlight.get(captureId);
      if (active) return active;
      const promise = run(captureId, manual)
        .catch((error: unknown) =>
          settle(put(captureId, { stage: 'failed', message: error instanceof Error ? error.message : t('Could not process the recording'), retryable: true })),
        )
        .finally(() => inFlight.delete(captureId));
      inFlight.set(captureId, promise);
      return promise;
    },
    cancel(captureId) {
      controllers.get(captureId)?.abort();
      sharedManualProvider.bridge.cancelPending();
    },
    forget(captureId) {
      store.setState((state) => {
        const { [captureId]: _gone, ...rest } = state.jobs;
        return { jobs: rest };
      });
    },
    onSettled(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    retryOffline() {
      for (const job of Object.values(store.getState().jobs)) {
        if (job.stage === 'waiting' && job.waiting === 'offline') void service.enqueue(job.captureId, { manual: job.mode === 'manual' });
      }
    },
  };
  return service;
}

/** The app's processing service. */
export const processing: ProcessingService = createProcessing();

/** The job of a capture, live. `undefined`: nothing runs for it in this session. */
export function useJob(captureId: ID | undefined): Job | undefined {
  return processing.store((state) => (captureId ? state.jobs[captureId] : undefined));
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => processing.retryOffline());
}
