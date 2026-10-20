import { addDays, localDayKey, startOfDayInstant } from '../../domain/dates';
import type { DateInput } from '../../domain/dates';
import type { DayKey, ISODate } from '../../domain/types';

/**
 * A point in the demo timeline, always relative to "now" so that "Сегодня" looks current whenever
 * the data is loaded:
 * - `{ d, t }` — `d` days ago (1 = yesterday) at local wall-clock time `t` (`HH:MM`);
 * - `{ ago }` — that many minutes before now (used for today, which cannot contain the future).
 */
export type Moment = { d: number; t: string } | { ago: number };

const MS_PER_MINUTE = 60_000;
/** Nothing in the demo happens in the last few minutes: "now" is the moment the data is loaded. */
const NEWEST_GAP_MINUTES = 5;
/** `{ ago }` moments are meant to fit into this many minutes before now (the demo uses up to ~3 hours). */
const AGO_RANGE_MINUTES = 240;

export interface DemoClock {
  readonly now: Date;
  /** The user's local today. */
  readonly today: DayKey;
  /** Local day `d` days ago. */
  day(d: number): DayKey;
  /** Instant of local wall-clock time `t` (`HH:MM`) on a day. */
  local(day: DayKey, t: string): Date;
  /** Instant of a moment; never later than a few minutes before now. */
  at(moment: Moment): Date;
}

function parseClock(t: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new RangeError(`Invalid time of day in the demo data: ${t}`);
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

export function createClock(input: DateInput): DemoClock {
  const now = new Date(input instanceof Date ? input.getTime() : input);
  if (Number.isNaN(now.getTime())) throw new RangeError(`Invalid date for the demo data: ${String(input)}`);
  const today = localDayKey(now);
  const todayStart = startOfDayInstant(today).getTime();
  // Never later than a few minutes before now, but not before the start of today either (right after
  // midnight "a few minutes ago" would be yesterday, and the newest record would not be today's).
  const newest = Math.max(now.getTime() - NEWEST_GAP_MINUTES * MS_PER_MINUTE, todayStart);

  const local = (day: DayKey, t: string): Date => {
    const { hours, minutes } = parseClock(t);
    const instant = startOfDayInstant(day);
    instant.setHours(hours, minutes, 0, 0);
    return instant;
  };

  const at = (moment: Moment): Date => {
    if (!('ago' in moment)) return new Date(Math.min(local(addDays(today, -moment.d), moment.t).getTime(), newest));
    const exact = Math.floor((now.getTime() - moment.ago * MS_PER_MINUTE) / MS_PER_MINUTE) * MS_PER_MINUTE;
    // Today cannot contain the past of yesterday: early in the day the moments are squeezed into what
    // is left of it, keeping their order.
    const instant =
      exact >= todayStart
        ? exact
        : newest - Math.floor(((newest - todayStart) * Math.min(moment.ago, AGO_RANGE_MINUTES)) / AGO_RANGE_MINUTES / MS_PER_MINUTE) * MS_PER_MINUTE;
    return new Date(Math.min(instant, newest));
  };

  return {
    now,
    today,
    day: (d) => addDays(today, -d),
    local,
    at,
  };
}

/** `instant + minutes`, as an ISO string. */
export const plusMinutes = (instant: Date | ISODate, minutes: number): ISODate =>
  new Date(new Date(instant).getTime() + minutes * MS_PER_MINUTE).toISOString();
