import type { NewCheckIn } from '../../db/repos/checkins';
import { HIDE_FROM_AI_TAG } from '../../domain/hidden';
import type { MoodStep } from '../../ui';
import { t, msg } from '../../i18n';

/**
 * Pure parts of the check-in: the vocabulary of the steps and the mapping from the screen's state to a
 * stored `CheckIn`.
 */

/** What affects the state (step 3). Stored as lower-case tags, like the tags the AI suggests. */
const FACTOR_KEYS = [msg('Money'), msg('Clients'), msg('Team'), msg('Content'), msg('Study'), msg('Sleep'), msg('People')] as const;

/** The factors in the current language. */
export const moodFactors = (): string[] => FACTOR_KEYS.map((key) => t(key));

export { HIDE_FROM_AI_TAG, isHiddenFromAi } from '../../domain/hidden';

export type EnergyLevel = 'low' | 'mid' | 'high';

export const ENERGY_VALUES: Record<EnergyLevel, number> = { low: 0.2, mid: 0.5, high: 0.85 };
export const ENERGY_OPTIONS: ReadonlyArray<{ value: EnergyLevel; label: string }> = [
  { value: 'low', get label() { return t('Low') } },
  { value: 'mid', get label() { return t('Medium') } },
  { value: 'high', get label() { return t('High') } },
];

/** The level closest to a stored energy (for editing an existing check-in). */
export function energyLevelOf(energy: number): EnergyLevel {
  if (energy < 0.35) return 'low';
  if (energy > 0.675) return 'high';
  return 'mid';
}

interface WordSet {
  /** 5–7 words shown at once. */
  featured: readonly string[];
  /** The rest, behind "Ещё". */
  more: readonly string[];
}

const NEGATIVE: WordSet = {
  featured: [msg('anxious'), msg('tired'), msg('irritated'), msg('empty'), msg('tense'), msg('overloaded')],
  more: [msg('sad'), msg('doubtful'), msg('angry'), msg('lonely'), msg('burned out'), msg('confused')],
};
const NEUTRAL: WordSet = {
  featured: [msg('steady'), msg('calm'), msg('focused'), msg('thoughtful'), msg('waiting'), msg('busy')],
  more: [msg('curious'), msg('collected'), msg('drained'), msg('detached'), msg('scattered')],
};
const POSITIVE: WordSet = {
  featured: [msg('joyful'), msg('confident'), msg('inspired'), msg('in flow'), msg('grateful'), msg('energetic')],
  more: [msg('proud'), msg('light'), msg('calm'), msg('playful'), msg('in love with the work'), msg('free')],
};

/** Words for a mood step: the near ones first, every other word still reachable under "Ещё". */
export function wordsForMood(step: MoodStep | number): WordSet {
  const band = step < 0 ? NEGATIVE : step > 0 ? POSITIVE : NEUTRAL;
  const others = [NEGATIVE, NEUTRAL, POSITIVE].filter((set) => set !== band);
  const featured = band.featured.map((word) => t(word));
  const more = [...new Set([...band.more, ...others.flatMap((set) => [...set.featured, ...set.more])].map((word) => t(word)))].filter((word) => !featured.includes(word));
  return { featured, more };
}

/** Lower-cases and trims a tag the way the rest of the app stores them. */
export const toTag = (text: string): string => text.trim().toLowerCase();

export interface CheckInDraft {
  step: MoodStep | number;
  energy: EnergyLevel;
  words: readonly string[];
  factors: readonly string[];
  note: string;
  hideFromAi: boolean;
}

/** The record the draft turns into. A mood step −3…+3 becomes valence −1…+1. */
export function draftToCheckIn(draft: CheckInDraft): NewCheckIn {
  const tags = [...new Set([...draft.words, ...draft.factors].map(toTag).filter((tag) => tag !== ''))];
  if (draft.hideFromAi) tags.push(HIDE_FROM_AI_TAG);
  const note = draft.note.trim();
  return {
    valence: Math.max(-1, Math.min(1, draft.step / 3)),
    energy: ENERGY_VALUES[draft.energy],
    tags,
    ...(note !== '' && { note }),
    origin: 'manual',
  };
}
