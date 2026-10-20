import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveDictation } from './live-dictation';
import type { DictationError, DictationState, DictationTranscript } from './live-dictation';
import { FakeRecognition } from './test-fakes';

/** A dictation wired to fake recognizers; `sessions` collects every recognizer the browser "created". */
function setup(options: ConstructorParameters<typeof LiveDictation>[0] = {}) {
  const sessions: FakeRecognition[] = [];
  const dictation = new LiveDictation({
    createRecognition: () => {
      const session = new FakeRecognition();
      sessions.push(session);
      return session;
    },
    continuous: true,
    ...options,
  });
  const states: DictationState[] = [];
  const transcripts: DictationTranscript[] = [];
  const errors: DictationError[] = [];
  dictation.on('state', (state) => states.push(state));
  dictation.on('transcript', (transcript) => transcripts.push(transcript));
  dictation.on('error', (error) => errors.push(error));
  return { dictation, sessions, states, transcripts, errors, current: () => sessions[sessions.length - 1]! };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('listening', () => {
  it('starts a Russian, interim-result recognition', () => {
    const { dictation, current, states } = setup({ continuous: undefined as never });
    dictation.start();
    expect(current()).toMatchObject({ lang: 'ru-RU', interimResults: true, maxAlternatives: 1, started: true });
    expect(dictation.state).toBe('listening');
    expect(states).toEqual(['listening']);
  });

  it('takes the language and the continuous mode from the options', () => {
    const { dictation, current } = setup({ lang: 'en-US', continuous: false });
    dictation.start();
    expect(current()).toMatchObject({ lang: 'en-US', continuous: false });
  });

  it('shows the phrase being spoken, then makes it final', () => {
    const { dictation, current, transcripts } = setup();
    dictation.start();

    current().say([['привет', false]]);
    expect(dictation.transcript).toEqual({ final: '', interim: 'привет' });
    current().say([['привет мир', false]]);
    current().say([['привет мир', true]]);
    expect(dictation.transcript).toEqual({ final: 'привет мир', interim: '' });

    current().say([['привет мир', true], ['как дела', false]], 1);
    expect(dictation.transcript).toEqual({ final: 'привет мир', interim: 'как дела' });
    current().say([['привет мир', true], ['как дела', true]], 1);
    expect(dictation.transcript).toEqual({ final: 'привет мир как дела', interim: '' });

    expect(transcripts.at(-1)).toEqual({ final: 'привет мир как дела', interim: '' });
  });

  it('ignores results before resultIndex and empty phrases', () => {
    const { dictation, current } = setup();
    dictation.start();
    current().say([['первое', true]]);
    current().say([['первое', true], ['  ', true], ['второе', true]], 1);
    expect(dictation.transcript.final).toBe('первое второе');
  });

  it('ignores a second start', () => {
    const { dictation, sessions } = setup();
    dictation.start();
    dictation.start();
    expect(sessions).toHaveLength(1);
  });
});

describe('restarting', () => {
  it('restarts a session that ended on its own and keeps the transcript', () => {
    const { dictation, sessions, current, states } = setup();
    dictation.start();
    current().say([['до обрыва', true]]);
    current().end();
    expect(dictation.state).toBe('restarting');
    expect(sessions).toHaveLength(1);

    vi.advanceTimersByTime(250);
    expect(sessions).toHaveLength(2);
    expect(current().started).toBe(true);
    expect(dictation.state).toBe('listening');

    current().say([['после', true]]);
    expect(dictation.transcript.final).toBe('до обрыва после');
    expect(states).toEqual(['listening', 'restarting', 'listening']);
  });

  it('does not lose a phrase that a session ended without confirming', () => {
    const { dictation, current } = setup();
    dictation.start();
    current().say([['недосказанная мысль', false]]);
    current().end();
    expect(dictation.transcript).toEqual({ final: 'недосказанная мысль', interim: '' });
  });

  it('waits longer after each session that dies at once, and gives up after maxIdleRestarts', () => {
    const { dictation, sessions, current, errors } = setup({ maxIdleRestarts: 3 });
    dictation.start();

    current().end();
    vi.advanceTimersByTime(249);
    expect(sessions).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sessions).toHaveLength(2);

    current().end();
    vi.advanceTimersByTime(499);
    expect(sessions).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sessions).toHaveLength(3);

    current().end();
    vi.advanceTimersByTime(1000);
    expect(sessions).toHaveLength(4);

    current().end();
    vi.advanceTimersByTime(10_000);
    expect(sessions).toHaveLength(4);
    expect(dictation.state).toBe('failed');
    expect(errors).toEqual([{ code: 'unknown', message: expect.stringContaining('Запись продолжается') }]);
  });

  it('does not count a quiet session as a failure: silence is not an error', () => {
    const { dictation, sessions, current, errors } = setup({ maxIdleRestarts: 2 });
    dictation.start();
    for (let round = 0; round < 6; round++) {
      vi.advanceTimersByTime(5_000);
      current().fail('no-speech');
      current().end();
      vi.advanceTimersByTime(250);
    }
    expect(sessions).toHaveLength(7);
    expect(dictation.state).toBe('listening');
    expect(errors).toEqual([]);
  });

  it('starts counting again after a recognized phrase', () => {
    const { dictation, sessions, current } = setup({ maxIdleRestarts: 2 });
    dictation.start();
    current().end();
    vi.advanceTimersByTime(250);
    current().say([['слово', true]]);
    current().end();
    vi.advanceTimersByTime(250);
    current().end();
    vi.advanceTimersByTime(500);
    expect(sessions).toHaveLength(4);
    expect(dictation.state).toBe('listening');
  });
});

describe('errors', () => {
  it.each([
    ['not-allowed', 'denied'],
    ['service-not-allowed', 'denied'],
    ['audio-capture', 'no-microphone'],
    ['language-not-supported', 'unsupported'],
  ])('stops for good on %s and says why in Russian', (error, code) => {
    const { dictation, sessions, current, errors } = setup();
    dictation.start();
    current().fail(error);
    current().end();
    vi.advanceTimersByTime(10_000);

    expect(sessions).toHaveLength(1);
    expect(dictation.state).toBe('failed');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe(code);
    expect(errors[0]?.message).toMatch(/[а-яё]/i);
  });

  it('retries after a network error, and tells the user about it', () => {
    const { dictation, sessions, current, errors } = setup();
    dictation.start();
    current().fail('network');
    current().end();
    vi.advanceTimersByTime(250);
    expect(sessions).toHaveLength(2);
    expect(errors.map((error) => error.code)).toEqual(['network']);
    expect(dictation.state).toBe('listening');
  });

  it('retries silently after no-speech and aborted', () => {
    const { dictation, sessions, current, errors } = setup();
    dictation.start();
    current().fail('no-speech');
    current().end();
    vi.advanceTimersByTime(250);
    current().fail('aborted');
    current().end();
    vi.advanceTimersByTime(500);
    expect(sessions).toHaveLength(3);
    expect(errors).toEqual([]);
  });

  it('reports a browser without speech recognition and does not throw', () => {
    const { dictation, errors } = setup({ createRecognition: undefined });
    // `undefined` falls back to the browser, which jsdom lacks.
    dictation.start();
    expect(dictation.state).toBe('failed');
    expect(errors.map((error) => error.code)).toEqual(['unsupported']);
    expect(LiveDictation.isSupported()).toBe(false);
  });

  it('survives a recognizer that refuses to start', () => {
    const sessions: FakeRecognition[] = [];
    const dictation = new LiveDictation({
      continuous: true,
      createRecognition: () => {
        const session = new FakeRecognition();
        if (sessions.length === 0) {
          session.start = () => {
            throw new DOMException('already started', 'InvalidStateError');
          };
        }
        sessions.push(session);
        return session;
      },
    });
    dictation.start();
    expect(dictation.state).toBe('restarting');
    vi.advanceTimersByTime(250);
    expect(sessions).toHaveLength(2);
    expect(dictation.state).toBe('listening');
  });
});

describe('stop', () => {
  it('waits for the final results and resolves with the whole text', async () => {
    const { dictation, current, states } = setup();
    dictation.start();
    current().say([['раз два', true], ['три', false]]);

    const text = await dictation.stop();

    expect(text).toBe('раз два три');
    expect(current().stopCalls).toBe(1);
    expect(dictation.state).toBe('stopped');
    expect(states).toEqual(['listening', 'stopped']);
  });

  it('does not restart afterwards', async () => {
    const { dictation, sessions } = setup();
    dictation.start();
    await dictation.stop();
    vi.advanceTimersByTime(10_000);
    expect(sessions).toHaveLength(1);
  });

  it('stops while waiting for a restart', async () => {
    const { dictation, sessions, current } = setup();
    dictation.start();
    current().say([['слово', true]]);
    current().end();
    expect(await dictation.stop()).toBe('слово');
    vi.advanceTimersByTime(10_000);
    expect(sessions).toHaveLength(1);
    expect(dictation.state).toBe('stopped');
  });

  it('does not hang on a browser that never ends the session', async () => {
    const { dictation, current } = setup();
    dictation.start();
    current().ignoreStop = true;
    current().say([['хвост', false]]);

    const pending = dictation.stop();
    await vi.advanceTimersByTimeAsync(1_500);

    expect(await pending).toBe('хвост');
  });

  it('returns the text so far when it was never started, and can listen again afterwards', async () => {
    const { dictation, sessions, current } = setup();
    expect(await dictation.stop()).toBe('');
    dictation.start();
    current().say([['один', true]]);
    await dictation.stop();
    dictation.start();
    expect(sessions).toHaveLength(2);
    current().say([['два', true]]);
    expect(dictation.transcript.final).toBe('один два');
  });
});

describe('Android', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('listens one phrase per session there, because long sessions repeat text, and everywhere else in one go', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile' });
    const android = setup({ continuous: undefined });
    android.dictation.start();
    expect(android.current().continuous).toBe(false);

    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126' });
    const desktop = setup({ continuous: undefined });
    desktop.dictation.start();
    expect(desktop.current().continuous).toBe(true);
  });
});
