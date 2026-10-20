import { Emitter } from './emitter';
import { t } from '../i18n';

// ───────── The slice of the Web Speech API used here (not in lib.dom) ─────────

interface SpeechAlternativeLike {
  readonly transcript: string;
}
interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternativeLike | undefined;
}
export interface SpeechResultEventLike {
  /** First result that changed in this event. */
  readonly resultIndex: number;
  readonly results: { readonly length: number; readonly [index: number]: SpeechResultLike | undefined };
}
export interface SpeechErrorEventLike {
  readonly error: string;
}
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type SpeechRecognitionFactory = () => SpeechRecognitionLike;

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/** Chrome, Edge and Safari have it, the latter two behind a `webkit` prefix. Undefined elsewhere (Firefox). */
export function browserSpeechRecognition(): SpeechRecognitionFactory | undefined {
  const scope = globalThis as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  return Recognition ? () => new Recognition() : undefined;
}

// ───────── Live dictation ─────────

export type DictationState = 'idle' | 'listening' | 'restarting' | 'stopped' | 'failed';

export interface DictationTranscript {
  /** Phrases the recognizer is sure of, joined with spaces. */
  final: string;
  /** The phrase being spoken right now; may still change. */
  interim: string;
}

export type DictationErrorCode = 'denied' | 'no-microphone' | 'unsupported' | 'network' | 'unknown';

const DICTATION_MESSAGES: Readonly<Record<DictationErrorCode, string>> = {
  get denied() { return t('The browser did not allow speech recognition. Check microphone access in the site settings.') },
  get 'no-microphone'() { return t('No microphone was found for live dictation.') },
  get unsupported() { return t('This browser cannot recognize speech on the fly. The recording will still be saved, and the text will appear after processing.') },
  get network() { return t('Speech recognition lost its connection to the browser service. The recording continues, and the text will appear after processing.') },
  get unknown() { return t('Live dictation stopped. The recording continues, and the text will appear after processing.') },
};

export interface DictationError {
  code: DictationErrorCode;
  message: string;
}

export interface DictationEvents {
  state: DictationState;
  transcript: DictationTranscript;
  error: DictationError;
}

export interface LiveDictationOptions {
  /** BCP-47 tag; default `ru-RU`. */
  lang?: string;
  createRecognition?: SpeechRecognitionFactory | undefined;
  /**
   * One long session (true) or one phrase per session, restarted by us (false). Android Chrome repeats
   * text in long sessions, so it defaults to false there and to true elsewhere.
   */
  continuous?: boolean;
  /** Sessions in a row that died at once, without a phrase, before giving up. */
  maxIdleRestarts?: number;
}

const RESTART_DELAY_MS = 250;
const MAX_RESTART_DELAY_MS = 3_000;
const STOP_TIMEOUT_MS = 1_500;
/** A session that lived this long was working, even if nobody spoke: silence is not a failure. */
const HEALTHY_SESSION_MS = 2_000;
const DEFAULT_MAX_IDLE_RESTARTS = 8;

const isAndroid = (): boolean => /Android/i.test((globalThis as { navigator?: Navigator }).navigator?.userAgent ?? '');

/** Errors after which trying again is pointless. */
const FATAL_ERRORS: Readonly<Record<string, DictationErrorCode>> = {
  'not-allowed': 'denied',
  'service-not-allowed': 'denied',
  'audio-capture': 'no-microphone',
  'language-not-supported': 'unsupported',
  'bad-grammar': 'unsupported',
};

/**
 * Browser speech recognition as a live "karaoke" transcript. Recognition sessions end on their
 * own (silence, a network blip, a time limit), so a session that ends while dictation is wanted
 * is restarted, with a growing pause when restarts keep coming up empty.
 *
 * The transcript is a hint for the screen and a free first draft of the text; the audio recording
 * is the source of truth and is transcribed again afterwards when a provider is configured.
 */
export class LiveDictation extends Emitter<DictationEvents> {
  private readonly createRecognition: SpeechRecognitionFactory | undefined;
  private readonly lang: string;
  private readonly continuous: boolean;
  private readonly maxIdleRestarts: number;

  private currentState: DictationState = 'idle';
  private recognition: SpeechRecognitionLike | undefined;
  private wanted = false;
  private readonly finals: string[] = [];
  private interim = '';
  private idleRestarts = 0;
  private sessionStartedAt = 0;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private endWaiters: (() => void)[] = [];

  constructor({
    lang = 'ru-RU',
    createRecognition = browserSpeechRecognition(),
    continuous = !isAndroid(),
    maxIdleRestarts = DEFAULT_MAX_IDLE_RESTARTS,
  }: LiveDictationOptions = {}) {
    super();
    this.createRecognition = createRecognition;
    this.lang = lang;
    this.continuous = continuous;
    this.maxIdleRestarts = maxIdleRestarts;
  }

  static isSupported(): boolean {
    return browserSpeechRecognition() !== undefined;
  }

  get state(): DictationState {
    return this.currentState;
  }

  get transcript(): DictationTranscript {
    return { final: this.finals.join(' '), interim: this.interim };
  }

  /** Starts listening. Without browser support it reports `unsupported` and does nothing else. */
  start(): void {
    if (this.wanted) return;
    if (!this.createRecognition) {
      this.fail('unsupported');
      return;
    }
    this.wanted = true;
    this.idleRestarts = 0;
    this.open(this.createRecognition);
  }

  /** Stops listening and resolves with everything recognized, interim phrase included. */
  async stop(): Promise<string> {
    if (this.wanted) {
      this.wanted = false;
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
      if (this.recognition) {
        await this.waitForEnd(this.recognition);
      } else {
        this.commitInterim();
      }
      if (this.currentState !== 'failed') this.setState('stopped');
    }
    return this.finals.join(' ');
  }

  // ───────── Internals ─────────

  private setState(state: DictationState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    this.emit('state', state);
  }

  private open(create: SpeechRecognitionFactory): void {
    const recognition = create();
    recognition.lang = this.lang;
    recognition.continuous = this.continuous;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => this.onResult(event);
    recognition.onerror = (event) => this.onError(event);
    recognition.onend = () => this.onEnd(recognition);
    this.recognition = recognition;
    this.sessionStartedAt = Date.now();
    try {
      recognition.start();
      this.setState('listening');
    } catch {
      // Starting twice or without a gesture throws; the end handler decides about a retry.
      this.onEnd(recognition);
    }
  }

  private onResult(event: SpeechResultEventLike): void {
    let interim = '';
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index];
      const text = result?.[0]?.transcript.trim();
      if (!result || !text) continue;
      if (result.isFinal) this.finals.push(text);
      else interim += `${interim ? ' ' : ''}${text}`;
    }
    this.interim = interim;
    this.idleRestarts = 0;
    this.emit('transcript', this.transcript);
  }

  private onError({ error }: SpeechErrorEventLike): void {
    const fatal = FATAL_ERRORS[error];
    if (fatal) {
      this.wanted = false;
      this.fail(fatal);
      return;
    }
    // `no-speech` and `aborted` are ordinary; `network` and the rest are retried by the end handler.
    if (error === 'network') this.emit('error', { code: 'network', message: DICTATION_MESSAGES.network });
  }

  private onEnd(ended: SpeechRecognitionLike): void {
    if (this.recognition !== ended) return;
    this.recognition = undefined;
    this.commitInterim();
    for (const resolve of this.endWaiters.splice(0)) resolve();
    if (!this.wanted || !this.createRecognition) return;
    if (Date.now() - this.sessionStartedAt >= HEALTHY_SESSION_MS) this.idleRestarts = 0;

    if (this.idleRestarts >= this.maxIdleRestarts) {
      this.wanted = false;
      this.fail('unknown');
      return;
    }
    const delay = Math.min(MAX_RESTART_DELAY_MS, RESTART_DELAY_MS * 2 ** this.idleRestarts);
    this.idleRestarts += 1;
    this.setState('restarting');
    const create = this.createRecognition;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.wanted) this.open(create);
    }, delay);
  }

  /** An unfinished phrase must not be lost when a session ends without confirming it. */
  private commitInterim(): void {
    if (!this.interim) return;
    this.finals.push(this.interim);
    this.interim = '';
    this.emit('transcript', this.transcript);
  }

  private waitForEnd(recognition: SpeechRecognitionLike): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.onEnd(recognition);
        resolve();
      }, STOP_TIMEOUT_MS);
      this.endWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
      try {
        recognition.stop();
      } catch {
        // Already stopped.
      }
    });
  }

  private fail(code: DictationErrorCode): void {
    this.setState('failed');
    this.emit('error', { code, message: DICTATION_MESSAGES[code] });
  }
}
