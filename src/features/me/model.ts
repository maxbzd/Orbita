import { addDays, startOfWeek } from '../../domain/dates';
import type { DayKey, Profile } from '../../domain/types';
import { t } from '../../i18n';

/**
 * «Контекст N %»: how much the AI can know about you. An honest formula, shown in the caption of the screen:
 * seven parts with fixed weights adding up to 100. A text field counts when it holds a real sentence
 * (at least `MIN_FIELD_CHARS` characters), facts and confirmed patterns count in proportion up to a target.
 * Nothing is estimated or inflated, and nothing here is a score of the person.
 */
export const MIN_FIELD_CHARS = 10;
export const MIN_NAME_CHARS = 2;
/** Active facts that fill the "Факты" part completely. */
export const FACT_TARGET = 5;
/** Confirmed patterns that fill the "Паттерны" part completely. */
export const PATTERN_TARGET = 3;

export type ContextPartId = 'name' | 'about' | 'goals' | 'values' | 'talkStyle' | 'facts' | 'patterns';

export interface ContextPart {
  id: ContextPartId;
  label: string;
  /** Share of the 100 % this part can give. */
  weight: number;
  /** What it gives now (an integer, 0…weight). */
  earned: number;
  /** What to do to get the rest. */
  hint: string;
}

export interface ContextCompleteness {
  /** 0…100, the sum of what the parts give. */
  percent: number;
  parts: ContextPart[];
}

export interface CompletenessInput {
  profile: Pick<Profile, 'name' | 'about' | 'goals' | 'values' | 'talkStyle'>;
  /** Active facts that nothing replaced. */
  factCount: number;
  confirmedPatternCount: number;
}

const filled = (text: string, min: number): boolean => text.trim().length >= min;
const share = (count: number, target: number, weight: number): number => Math.round(weight * Math.min(Math.max(count, 0), target) / target);

export function contextCompleteness({ profile, factCount, confirmedPatternCount }: CompletenessInput): ContextCompleteness {
  const parts: ContextPart[] = [
    { id: 'name', label: t('Name', undefined, 'model'), weight: 10, earned: filled(profile.name, MIN_NAME_CHARS) ? 10 : 0, hint: t('how to address you') },
    { id: 'about', label: t('Who I am'), weight: 20, earned: filled(profile.about, MIN_FIELD_CHARS) ? 20 : 0, hint: t('a couple of lines about you and your work') },
    { id: 'goals', label: t('Goals'), weight: 15, earned: filled(profile.goals, MIN_FIELD_CHARS) ? 15 : 0, hint: t('where you are heading') },
    { id: 'values', label: t('Values'), weight: 10, earned: filled(profile.values, MIN_FIELD_CHARS) ? 10 : 0, hint: t('what matters to you') },
    { id: 'talkStyle', label: t('How to talk to me'), weight: 10, earned: filled(profile.talkStyle, MIN_FIELD_CHARS) ? 10 : 0, hint: t('tone and length of answers') },
    { id: 'facts', label: t('Facts'), weight: 20, earned: share(factCount, FACT_TARGET, 20), hint: t('lasting facts about you and your work, up to {FACT_TARGET}', { FACT_TARGET }) },
    { id: 'patterns', label: t('Confirmed patterns'), weight: 15, earned: share(confirmedPatternCount, PATTERN_TARGET, 15), hint: t('confirmed patterns, up to {PATTERN_TARGET}', { PATTERN_TARGET }) },
  ];
  return { percent: parts.reduce((sum, part) => sum + part.earned, 0), parts };
}

/** The parts that still give something, the biggest gain first (what to add next). */
export function nextSteps(completeness: ContextCompleteness, limit = 3): ContextPart[] {
  return completeness.parts
    .filter((part) => part.earned < part.weight)
    .sort((a, b) => b.weight - b.earned - (a.weight - a.earned))
    .slice(0, limit);
}

// ───────── Weeks with entries ─────────

export interface WeekCell {
  /** Monday of the week. */
  start: DayKey;
  /** At least one capture that week. */
  has: boolean;
  /** The week we are in: it can still get its first entry. */
  current: boolean;
}

export const STREAK_WEEKS = 12;

/** The last `weeks` weeks, oldest first, the last one is the current week. `counts` is captures per day. */
export function weekCells(counts: Readonly<Record<DayKey, number>>, today: DayKey, weeks: number = STREAK_WEEKS): WeekCell[] {
  const thisWeek = startOfWeek(today);
  const cells: WeekCell[] = Array.from({ length: weeks }, (_, index) => {
    const start = addDays(thisWeek, -7 * (weeks - 1 - index));
    return { start, has: false, current: index === weeks - 1 };
  });
  const byStart = new Map(cells.map((cell) => [cell.start, cell]));
  for (const [day, count] of Object.entries(counts)) {
    if (count <= 0) continue;
    const cell = byStart.get(startOfWeek(day));
    if (cell) cell.has = true;
  }
  return cells;
}

export interface WeekStats {
  withEntries: number;
  total: number;
  /** Consecutive weeks with entries up to now. An empty current week does not break it: it is not over yet. */
  run: number;
}

export function weekStats(cells: readonly WeekCell[]): WeekStats {
  let run = 0;
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const cell = cells[index];
    if (!cell) break;
    if (cell.has) run += 1;
    else if (!cell.current) break;
  }
  return { withEntries: cells.filter((cell) => cell.has).length, total: cells.length, run };
}

/** `Д` for «Дмитрий»: the avatar letter. */
export function avatarInitial(name: string): string {
  const letter = Array.from(name.trim())[0];
  return letter ? letter.toLocaleUpperCase('ru-RU') : t('Me');
}
