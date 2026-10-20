import { addDays, eachDay, endOfMonth, formatDayLong, startOfMonth, startOfWeek, weekdayIndex } from '../../domain/dates';
import type { DayKey } from '../../domain/types';
import { recordsCount } from '../../domain/counts';
import { moodWord } from './mood';
import { t, msg } from '../../i18n';

/** One day of data in a calendar-like figure. */
export interface DayCell {
  date: DayKey;
  /** Mood of the day, −3…+3. Null/undefined: no state recorded. */
  mood?: number | null;
  /** Number of records that day. */
  count?: number;
}

export const WEEKDAYS_SHORT = [msg('Mon'), msg('Tue'), msg('Wed'), msg('Thu'), msg('Fri'), msg('Sat'), msg('Sun')] as const;
export const MONTHS_SHORT = [msg('JAN'), msg('FEB'), msg('MAR'), msg('APR'), msg('MAY'), msg('JUN'), msg('JUL'), msg('AUG'), msg('SEP'), msg('OCT'), msg('NOV'), msg('DEC')] as const;
export const MONTHS_NOMINATIVE = [msg('January'), msg('February'), msg('March'), msg('April'), msg('May'), msg('June'), msg('July'), msg('August'), msg('September'), msg('October'), msg('November'), msg('December')] as const;

export type DayRelation = 'past' | 'today' | 'future';

/** Day keys sort as strings, so comparing them is comparing dates. */
export function relationOf(date: DayKey, today: DayKey | null | undefined): DayRelation {
  if (!today) return 'past';
  if (date === today) return 'today';
  return date < today ? 'past' : 'future';
}

/** Every day key of a month given as `YYYY-MM`. */
export function monthDayKeys(monthKey: string): DayKey[] {
  const first = startOfMonth(`${monthKey}-01`);
  return eachDay(first, endOfMonth(first));
}

/** The seven days of the Monday-first week that contains `day`. */
export function weekDayKeys(day: DayKey): DayKey[] {
  const monday = startOfWeek(day);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function indexCells(cells: readonly DayCell[] | undefined): Map<DayKey, DayCell> {
  return new Map((cells ?? []).map((cell) => [cell.date, cell]));
}

/** Column (Monday = 0) and row of a day in a Monday-first month grid. */
export function monthGridCell(date: DayKey): { col: number; row: number } {
  const first = startOfMonth(date);
  const offset = weekdayIndex(first);
  const dayOfMonth = Number(date.slice(8, 10));
  const slot = offset + dayOfMonth - 1;
  return { col: slot % 7, row: Math.floor(slot / 7) };
}

/** "среда, 7 октября, Приятно, записей: 3" — what a screen reader says about a day. */
export function describeCell(date: DayKey, cell: DayCell | undefined, relation: DayRelation): string {
  const parts: string[] = [formatDayLong(date)];
  if (relation === 'today') parts.push(t('today'));
  if (cell?.mood !== null && cell?.mood !== undefined) parts.push(moodWord(cell.mood));
  if (cell?.count) parts.push(recordsCount(cell.count));
  else if (relation !== 'future') parts.push(t('no records'));
  return parts.join(', ');
}

/** Average mood of the cells that have one, or null. */
export function averageMood(cells: readonly DayCell[]): number | null {
  const moods = cells.map((c) => c.mood).filter((m): m is number => m !== null && m !== undefined);
  return moods.length === 0 ? null : moods.reduce((sum, m) => sum + m, 0) / moods.length;
}
