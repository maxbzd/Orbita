import { useCallback, useEffect, useRef, useState } from 'react';
import { LiveDictation } from '../../audio';

export interface DictationControls {
  supported: boolean;
  listening: boolean;
  /** Text recognized so far in this session (final and interim). */
  text: string;
  error: string | null;
  start(): void;
  /** Stops and returns the recognized text. */
  stop(): Promise<string>;
}

/** The microphone button of the composer: browser live dictation, when the browser has it. */
export function useDictation(lang: string): DictationControls {
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const session = useRef<LiveDictation | null>(null);

  useEffect(
    () => () => {
      void session.current?.stop();
    },
    [],
  );

  const start = useCallback(() => {
    if (session.current) return;
    const dictation = new LiveDictation({ lang });
    session.current = dictation;
    setError(null);
    setText('');
    dictation.on('transcript', ({ final, interim }) => setText([final, interim].filter(Boolean).join(' ')));
    dictation.on('error', ({ message }) => setError(message));
    dictation.on('state', (state) => {
      setListening(state === 'listening' || state === 'restarting');
      if (state === 'failed') session.current = null;
    });
    dictation.start();
  }, [lang]);

  const stop = useCallback(async () => {
    const dictation = session.current;
    session.current = null;
    if (!dictation) return '';
    const result = await dictation.stop();
    setListening(false);
    return result;
  }, []);

  return { supported: LiveDictation.isSupported(), listening, text, error, start, stop };
}
