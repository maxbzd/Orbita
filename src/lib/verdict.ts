import { formatDayLong } from '../domain/dates';
import { recordsCount } from '../domain/counts';
import { t, tn } from '../i18n';
import type { DayKey } from '../domain/types';

/**
 * The verdict of the day and the greeting of "Сегодня": plain rules over the day's counters, no AI
 *. Pure functions, so they work offline and are easy to test.
 */

/** Counters the verdict is derived from. */
export interface DayCounts {
  /** Records made on the day. */
  captures: number;
  /** Decisions recorded on the day. */
  decisions: number;
  /** Ideas recorded on the day. */
  ideas: number;
  /** Open commitments of the user ("я должен") whose deadline has passed. */
  overdue: number;
}

export const EMPTY_DAY_COUNTS: DayCounts = { captures: 0, decisions: 0, ideas: 0, overdue: 0 };

/** Decisions on one day that make it "День решений". */
export const DECISIONS_FOR_VERDICT = 3;
/** Ideas on one day that make it "Много идей". */
export const IDEAS_FOR_VERDICT = 5;

const upperFirst = (text: string): string => (text === '' ? text : text[0]!.toUpperCase() + text.slice(1));

/** "Среда, 7 октября": the fallback verdict when nothing stands out. */
export function dateVerdict(day: DayKey): string {
  return upperFirst(formatDayLong(day));
}

/**
 * One phrase for the day, the first rule that fits wins:
 * overdue promises → 3+ decisions → 5+ ideas → no records → the date.
 */
export function dayVerdict(counts: DayCounts, day: DayKey): string {
  if (counts.overdue > 0) return t('There are debts on promises');
  if (counts.decisions >= DECISIONS_FOR_VERDICT) return t('A day of decisions');
  if (counts.ideas >= IDEAS_FOR_VERDICT) return t('Many ideas');
  if (counts.captures === 0) return t('A quiet day');
  return dateVerdict(day);
}

/** Greeting by the hour: 5–11 morning, 11–17 day, 17–23 evening, 23–5 night. */
export function greetingForHour(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if (h >= 5 && h < 11) return t('Good morning');
  if (h >= 11 && h < 17) return t('Good afternoon');
  if (h >= 17 && h < 23) return t('Good evening');
  return t('Good night');
}

/** "Добрый вечер" or "Добрый вечер, Фёдор": the name comes from the profile, if there is one. */
export function greetingLine(hour: number, name?: string | null): string {
  const greeting = greetingForHour(hour);
  const clean = name?.trim();
  return clean ? `${greeting}, ${clean}` : greeting;
}

/** True from 18:00 to the end of the day: the "Закрыть день" card is shown. */
export function isEveningHour(hour: number): boolean {
  const h = Math.floor(hour);
  return h >= 18 && h < 24;
}

/** "2 записи. 1 дело горит." / "Записей пока нет. Ничего не горит." */
export function daySummary({ captures, burning }: { captures: number; burning: number }): string {
  const records = captures > 0 ? `${recordsCount(captures)}.` : t('No records yet.');
  if (burning <= 0) return t('{records} Nothing is burning.', { records });
  return `${records} ${tn(burning, '{n} thing is burning.', '{n} things are burning.')}`;
}
