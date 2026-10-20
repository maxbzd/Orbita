import { describe, expect, it } from 'vitest';
import { UnsupportedError } from '../../errors';
import { createBrowserStt, isBrowserSpeechAvailable, speechLanguage } from './browser';

describe('browser speech recognition', () => {
  it('detects the standard and the webkit-prefixed constructor', () => {
    expect(isBrowserSpeechAvailable({})).toBe(false);
    expect(isBrowserSpeechAvailable({ webkitSpeechRecognition: class {} })).toBe(true);
    expect(isBrowserSpeechAvailable({ SpeechRecognition: class {} })).toBe(true);
    expect(isBrowserSpeechAvailable({ SpeechRecognition: 'not a constructor' })).toBe(false);
  });

  it('maps short languages to locales and keeps full ones', () => {
    expect(speechLanguage('ru')).toBe('ru-RU');
    expect(speechLanguage(' EN ')).toBe('en-US');
    expect(speechLanguage('en-GB')).toBe('en-GB');
    expect(speechLanguage('xx')).toBe('xx');
  });

  it('explains that finished recordings need an API recognizer, in Russian', async () => {
    const stt = createBrowserStt();
    expect(stt.id).toBe('browser');
    const error = (await stt.transcribe(new Blob(['x']), { lang: 'ru' }).catch((e: unknown) => e)) as UnsupportedError;
    expect(error).toBeInstanceOf(UnsupportedError);
    expect(error.message).toContain('Настройки → Речь');
  });
});
