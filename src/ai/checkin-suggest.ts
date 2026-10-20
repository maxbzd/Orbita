import { checkinsRepo } from '../db';
import type { Capture, CheckIn } from '../domain/types';
import type { ExtractedMood } from './prompts/schemas';

/**
 * A state ("Состояние") suggested from what the author said. The extraction returns it with a confidence;
 * a confident one is stored as a check-in with `origin: 'ai_suggested'` that the user confirms or
 * removes. Nothing the user entered or confirmed is ever overwritten.
 */

/** Below this the model is guessing; no suggestion is made. */
export const MOOD_MIN_CONFIDENCE = 0.5;
const MAX_TAGS = 5;

function cleanTags(tags: readonly string[]): string[] {
  const cleaned = tags.map((tag) => tag.trim().toLowerCase().replace(/^#/, '')).filter((tag) => tag !== '' && tag.length <= 30);
  return [...new Set(cleaned)].slice(0, MAX_TAGS);
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The check-in the mood would become (not saved). Scales are clamped by the repository. */
export function moodToCheckIn(capture: Pick<Capture, 'id' | 'day' | 'createdAt' | 'isDemo'>, mood: ExtractedMood): checkinsRepo.NewCheckIn {
  const note = mood.note?.trim();
  return {
    at: capture.createdAt,
    day: capture.day,
    valence: mood.valence,
    energy: mood.energy,
    ...(isNumber(mood.focus) && { focus: mood.focus }),
    ...(isNumber(mood.stress) && { stress: mood.stress }),
    tags: cleanTags(mood.tags),
    ...(note && { note }),
    captureId: capture.id,
    origin: 'ai_suggested',
    ...(capture.isDemo && { isDemo: true }),
  };
}

/**
 * Makes the stored suggestion for a capture match the mood: creates it, refreshes an earlier suggestion,
 * or removes it when the mood is gone or not confident any more. Returns the suggestion, if there is one.
 */
export async function applyMoodSuggestion(capture: Capture, mood: ExtractedMood | null | undefined): Promise<CheckIn | undefined> {
  const own = (await checkinsRepo.listByDay(capture.day)).filter((checkIn) => checkIn.captureId === capture.id);
  // The user already answered for this capture: theirs wins.
  if (own.some((checkIn) => checkIn.origin !== 'ai_suggested')) return undefined;
  const suggested = own.find((checkIn) => checkIn.origin === 'ai_suggested');

  const usable = mood && isNumber(mood.valence) && isNumber(mood.energy) && isNumber(mood.confidence) && mood.confidence >= MOOD_MIN_CONFIDENCE;
  if (!usable) {
    if (suggested) await checkinsRepo.destroy(suggested.id);
    return undefined;
  }

  const draft = moodToCheckIn(capture, mood);
  if (!suggested) return checkinsRepo.create(draft);
  return checkinsRepo.update(suggested.id, {
    valence: draft.valence,
    energy: draft.energy,
    focus: draft.focus,
    stress: draft.stress,
    tags: draft.tags,
    note: draft.note,
  });
}
