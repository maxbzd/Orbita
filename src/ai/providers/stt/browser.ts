import { UnsupportedError } from '../../errors';
import type { SttProvider } from '../types';
import { t } from '../../../i18n';

/**
 * The browser's own speech recognition (`SpeechRecognition`, Chrome / Edge / Safari). It listens to the
 * microphone while the user speaks — live dictation lives in `audio/` next to the recorder — so it
 * cannot recognize a finished recording: here it is only a named option in the settings, with an
 * availability check and an honest answer when someone asks it to transcribe a file.
 */

/** Where to look for the constructor; tests pass a fake window. */
export interface SpeechEnvironment {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
}

export function isBrowserSpeechAvailable(env: SpeechEnvironment = globalThis as SpeechEnvironment): boolean {
  return typeof (env.SpeechRecognition ?? env.webkitSpeechRecognition) === 'function';
}

/** `ru` → `ru-RU`: the Web Speech API wants a region. */
export function speechLanguage(lang: string): string {
  const trimmed = lang.trim();
  if (trimmed.includes('-')) return trimmed;
  return { ru: 'ru-RU', en: 'en-US', uk: 'uk-UA', de: 'de-DE', es: 'es-ES', fr: 'fr-FR' }[trimmed.toLowerCase()] ?? trimmed;
}

export function createBrowserStt(): SttProvider {
  return {
    id: 'browser',
    async transcribe() {
      throw new UnsupportedError(
        t('In-browser recognition works only while recording. To recognise a finished recording, enable API recognition in Settings → Speech.'),
      );
    },
  };
}
