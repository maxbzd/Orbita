import { localMinutesOfDay, relativeDay, diffDays, formatDayLong, formatDayShort, formatDayWithWeekday, localDayKey } from '../../domain/dates';
import type { DayKey, ISODate } from '../../domain/types';
import { t } from '../../i18n';

/** Parts of a day the stream groups records into. Night is its own part so a 01:30 thought is not "evening". */
export type DayPart = 'night' | 'morning' | 'day' | 'evening';

export const DAY_PART_LABELS: Record<DayPart, string> = {
  get night() { return t('Night') },
  get morning() { return t('Morning') },
  get day() { return t('Day') },
  get evening() { return t('Evening') },
};

/** 00:00–04:59 night, 05:00–11:59 morning, 12:00–17:59 day, 18:00–23:59 evening. */
export function dayPartOfMinutes(minutesOfDay: number): DayPart {
  if (minutesOfDay < 5 * 60) return 'night';
  if (minutesOfDay < 12 * 60) return 'morning';
  if (minutesOfDay < 18 * 60) return 'day';
  return 'evening';
}

export function dayPartOf(at: ISODate, timeZone?: string): DayPart {
  return dayPartOfMinutes(localMinutesOfDay(at, timeZone));
}

export interface DayHeading {
  title: string;
  /** The date in words when the title is a relative word ("среда, 7 октября" under "Сегодня"). */
  subtitle?: string;
}

/** "Сегодня" / "Вчера" with the date underneath; further back the weekday and date, with the year when it differs. */
export function dayHeading(day: DayKey, today: DayKey = localDayKey()): DayHeading {
  const delta = diffDays(today, day);
  if (delta === 0 || delta === -1) {
    const word = relativeDay(day, today);
    return { title: word.charAt(0).toUpperCase() + word.slice(1), subtitle: formatDayLong(day) };
  }
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  const title = sameYear ? formatDayWithWeekday(day) : formatDayShort(day, { withYear: true });
  return { title: title.charAt(0).toUpperCase() + title.slice(1) };
}
