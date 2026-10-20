import { Emitter } from '../audio/emitter';
import type { RecorderEvents, RecorderState, RecordingResult } from '../audio';
import { capturesRepo } from '../db';
import type { ID } from '../domain/types';
import type { DictationLike, RecorderLike } from './recorder';

/** Test doubles of the recording machine's collaborators. */

/** A recorder that does what the real one promises to the database, without a microphone. */
export class FakeRecorder extends Emitter<RecorderEvents> implements RecorderLike {
  state: RecorderState = 'idle';
  elapsedMs = 0;
  startCalls = 0;
  stopCalls = 0;
  cancelCalls = 0;
  /** Set to make `start()` fail (a refused microphone). */
  startError: unknown;
  /** What `stop()` resolves with; `null` means nothing was recorded. */
  empty = false;
  private levelListeners = new Set<(level: number) => void>();

  constructor(readonly captureId: ID = `capture-${Math.random().toString(36).slice(2, 8)}`) {
    super();
  }

  readonly level = {
    value: 0,
    subscribe: (listener: (level: number) => void) => {
      this.levelListeners.add(listener);
      return () => {
        this.levelListeners.delete(listener);
      };
    },
  };

  speak(level: number): void {
    for (const listener of this.levelListeners) listener(level);
  }

  fire<K extends keyof RecorderEvents>(event: K, payload: RecorderEvents[K]): void {
    this.emit(event, payload);
  }

  tick(elapsedMs: number): void {
    this.elapsedMs = elapsedMs;
    this.emit('tick', { elapsedMs });
  }

  async start(): Promise<void> {
    this.startCalls += 1;
    this.state = 'starting';
    if (this.startError) {
      this.state = 'failed';
      throw this.startError;
    }
    await capturesRepo.create({ id: this.captureId, kind: 'voice', text: '', status: 'raw' });
    this.state = 'recording';
    this.emit('state', 'recording');
  }

  pause(): void {
    this.state = 'paused';
    this.emit('state', 'paused');
  }

  resume(): void {
    this.state = 'recording';
    this.emit('state', 'recording');
  }

  async stop(): Promise<RecordingResult | null> {
    this.stopCalls += 1;
    this.state = 'finished';
    if (this.empty) {
      await capturesRepo.destroy(this.captureId);
      return null;
    }
    const result: RecordingResult = {
      captureId: this.captureId,
      audioId: `audio-${this.captureId}`,
      mime: 'audio/webm',
      sizeBytes: 1024,
      durationSec: this.elapsedMs / 1000,
      chunks: 1,
      interrupted: false,
    };
    await capturesRepo.update(this.captureId, { durationSec: result.durationSec });
    this.emit('finish', result);
    return result;
  }

  async cancel(): Promise<void> {
    this.cancelCalls += 1;
    this.state = 'cancelled';
    await capturesRepo.destroy(this.captureId);
  }
}

/** Live dictation by hand: `say()` plays what the recogniser heard. */
export class FakeDictation extends Emitter<{ state: 'listening' | 'stopped'; transcript: { final: string; interim: string }; error: { code: string; message: string } }> implements DictationLike {
  starts = 0;
  stops = 0;
  private finals: string[] = [];
  private interim = '';

  get transcript(): { final: string; interim: string } {
    return { final: this.finals.join(' '), interim: this.interim };
  }

  start(): void {
    this.starts += 1;
    this.emit('state', 'listening');
  }

  async stop(): Promise<string> {
    this.stops += 1;
    if (this.interim) this.finals.push(this.interim);
    this.interim = '';
    return this.finals.join(' ');
  }

  /** A confirmed phrase. */
  say(text: string): void {
    this.finals.push(text);
    this.emit('transcript', this.transcript);
  }

  /** A phrase still being spoken. */
  hear(text: string): void {
    this.interim = text;
    this.emit('transcript', this.transcript);
  }
}

/** jsdom has no PointerEvent: a MouseEvent with a pointer id, enough for the gestures tests. */
export function installPointerEvent(): void {
  if (typeof window.PointerEvent === 'function') return;
  class TestPointerEvent extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'touch';
    }
  }
  Object.defineProperty(window, 'PointerEvent', { value: TestPointerEvent, configurable: true });
  // `setPointerCapture` is not implemented either.
  for (const name of ['setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(name in HTMLElement.prototype)) Object.defineProperty(HTMLElement.prototype, name, { value: () => undefined, configurable: true });
  }
}
