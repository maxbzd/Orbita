import { NotFoundError, audioRepo, capturesRepo, profileRepo, settingsRepo } from '../db';
import type { Capture, GlossaryEntry, ID, ProcessStatus, Settings } from '../domain/types';
import { AbortedError, UnsupportedError, describeError } from './errors';
import type { SttProvider } from './providers/types';
import { t } from '../i18n';

/**
 * Speech recognition of a stored recording: audio → text, with the author's glossary used twice —
 * as a vocabulary hint for the recognizer and as a light clean-up of what comes back.
 */

/** Abbreviations that recognizers like to write in lower case or letter by letter. */
const BUILTIN_TERMS = ['OKR', 'KPI', 'CRM'] as const;
const MAX_HINT_TERMS = 60;
const MAX_HINT_CHARS = 600;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD_START = '(?<![\\p{L}\\p{N}])';
const WORD_END = '(?![\\p{L}\\p{N}])';

function glossaryTerms(glossary: readonly GlossaryEntry[]): string[] {
  const terms = [...BUILTIN_TERMS, ...glossary.map((entry) => entry.term.trim())].filter((term) => term !== '');
  return [...new Set(terms)];
}

/** "Термины: …" for the recognizer's `prompt` field: it nudges spelling of rare words. */
export function buildSttPrompt(glossary: readonly GlossaryEntry[]): string {
  const terms = glossaryTerms(glossary).filter((term) => !(BUILTIN_TERMS as readonly string[]).includes(term));
  const listed: string[] = [];
  let length = 0;
  for (const term of [...BUILTIN_TERMS, ...terms].slice(0, MAX_HINT_TERMS)) {
    if (length + term.length + 2 > MAX_HINT_CHARS) break;
    listed.push(term);
    length += term.length + 2;
  }
  return t('Terms: {v}.', { v: listed.join(', ') });
}

export interface GlossaryResult {
  text: string;
  replacements: number;
}

/**
 * Fixes what can be fixed without guessing: a term written with capitals (OKR, Zoom) gets its spelling
 * back wherever the recognizer wrote it differently ("okr"), and an abbreviation spelled out with
 * hyphens or dots ("е-г-э", "е.г.э.") is joined. Inflected words are never rewritten — in Russian a
 * "close" word is usually the same word in another case.
 */
export function applyGlossary(text: string, glossary: readonly GlossaryEntry[]): GlossaryResult {
  let result = text;
  let replacements = 0;
  const count = (replacement: string) => (match: string) => {
    if (match !== replacement) replacements++;
    return replacement;
  };

  for (const term of glossaryTerms(glossary).sort((a, b) => b.length - a.length)) {
    // Terms in lower case ("тестовик") are left alone: capitalizing the first word of a sentence is correct.
    if (term === term.toLowerCase()) continue;
    result = result.replace(new RegExp(`${WORD_START}${escapeRegExp(term)}${WORD_END}`, 'giu'), count(term));
    if (/^\p{Lu}{3,6}$/u.test(term)) {
      const spelled = [...term].map(escapeRegExp).join('[.\\-]');
      result = result.replace(new RegExp(`${WORD_START}${spelled}\\.?${WORD_END}`, 'giu'), count(term));
    }
  }
  return { text: result, replacements };
}

export interface TranscribeDeps {
  stt: SttProvider;
  /** Defaults to the stored settings. */
  settings?: Settings;
  signal?: AbortSignal;
}

/** Where a capture goes back to when work on it is cancelled: busy statuses are not a place to rest. */
export function restingStatus(status: ProcessStatus, fallback: ProcessStatus): ProcessStatus {
  return status === 'transcribing' || status === 'extracting' ? fallback : status;
}

/**
 * Recognizes the recording of a capture and stores the text: `rawText` as the recognizer wrote it,
 * `text` after the glossary clean-up. Silence ends in `skipped`. Replaces any earlier text.
 * Failures are saved on the capture (`failed` + message) and rethrown; cancelling restores the status.
 */
export async function transcribeCapture(captureId: ID, deps: TranscribeDeps): Promise<Capture> {
  const capture = await capturesRepo.get(captureId);
  if (!capture || capture.deletedAt) throw new NotFoundError('captures', captureId);
  const audio = await audioRepo.getForCapture(captureId);
  if (!audio) throw new UnsupportedError(t('The record has no audio to recognise.'));

  const settings = deps.settings ?? (await settingsRepo.getSettings());
  const profile = await profileRepo.get();
  const before = restingStatus(capture.status, 'raw');

  await capturesRepo.setStatus(captureId, 'transcribing');
  try {
    const recognized = await deps.stt.transcribe(audio.data, {
      lang: settings.stt.language,
      prompt: buildSttPrompt(profile.glossary),
      ...(capture.durationSec !== undefined && { durationSec: capture.durationSec }),
      signal: deps.signal,
    });
    const rawText = recognized.text.trim();
    if (rawText === '') {
      return await capturesRepo.update(captureId, { status: 'skipped', rawText: '', text: '', error: undefined });
    }
    const durationSec = capture.durationSec ?? recognized.durationSec;
    return await capturesRepo.update(captureId, {
      rawText,
      text: applyGlossary(rawText, profile.glossary).text,
      status: 'transcribed',
      error: undefined,
      ...(durationSec !== undefined && { durationSec }),
    });
  } catch (error) {
    if (error instanceof AbortedError) await capturesRepo.setStatus(captureId, before);
    else await capturesRepo.markFailed(captureId, describeError(error));
    throw error;
  }
}
