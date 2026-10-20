import { getLocale, intlTag, t, tn } from '../i18n';
import type { DayKey, ISODate, ReviewPeriod } from './types';

/**
 * Dates and local days. Instants are UTC ISO strings; "days" are `YYYY-MM-DD` keys in the user's
 * time zone. Calendar arithmetic on day keys is time-zone independent (pure Gregorian math),
 * conversions between instants and days take an optional IANA `timeZone` (default: the device's).
 * Weeks start on Monday.
 */

export type DateInput = Date | ISODate | number;

export interface DayRange {
  startDay: DayKey;
  endDay: DayKey;
}

interface CalendarDate {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// ───────── Instants ─────────

export function nowISO(): ISODate {
  return new Date().toISOString();
}

function toDate(input: DateInput): Date {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${String(input)}`);
  return date;
}

// ───────── Day keys ─────────

const pad = (value: number, length = 2): string => String(value).padStart(length, '0');

function formatCalendarDate({ year, month, day }: CalendarDate): DayKey {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function utcMs({ year, month, day }: CalendarDate): number {
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): CalendarDate {
  const date = new Date(ms);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** True for a real calendar day in `YYYY-MM-DD` form (`2026-02-30` is not). */
export function isDayKey(value: string): boolean {
  const match = DAY_KEY_PATTERN.exec(value);
  if (!match) return false;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  return formatCalendarDate(fromUtcMs(utcMs(date))) === value;
}

function parseDayKey(day: DayKey): CalendarDate {
  if (!isDayKey(day)) throw new RangeError(`Invalid day key: ${day}`);
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return { year, month, day: date };
}

const zonedPartsFormats = new Map<string, Intl.DateTimeFormat>();

function zonedPartsFormat(timeZone: string): Intl.DateTimeFormat {
  let format = zonedPartsFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    zonedPartsFormats.set(timeZone, format);
  }
  return format;
}

/** Wall-clock fields of an instant in a time zone. */
function zonedFields(date: Date, timeZone: string): CalendarDate & { hour: number; minute: number; second: number } {
  const fields: Record<string, number> = {};
  for (const part of zonedPartsFormat(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  return {
    year: fields.year,
    month: fields.month,
    day: fields.day,
    hour: fields.hour,
    minute: fields.minute,
    second: fields.second,
  };
}

/** Offset of `timeZone` from UTC at an instant, in minutes (Moscow → 180). */
function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const f = zonedFields(date, timeZone);
  const wallAsUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return Math.round((wallAsUtc - Math.floor(date.getTime() / 1000) * 1000) / MS_PER_MINUTE);
}

/** Local day of an instant. */
export function localDayKey(input: DateInput = new Date(), timeZone?: string): DayKey {
  const date = toDate(input);
  if (timeZone) return formatCalendarDate(zonedFields(date, timeZone));
  return formatCalendarDate({ year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() });
}

/** Minutes since local midnight (wall clock; on DST days it can exceed the real elapsed time). */
export function localMinutesOfDay(input: DateInput, timeZone?: string): number {
  const date = toDate(input);
  if (timeZone) {
    const f = zonedFields(date, timeZone);
    return f.hour * 60 + f.minute;
  }
  return date.getHours() * 60 + date.getMinutes();
}

/** The instant when local day `day` begins. */
export function startOfDayInstant(day: DayKey, timeZone?: string): Date {
  const { year, month, day: dayOfMonth } = parseDayKey(day);
  if (!timeZone) return new Date(year, month - 1, dayOfMonth);
  const wallAsUtc = Date.UTC(year, month - 1, dayOfMonth);
  // The offset must be taken at the answer itself, so settle in two passes (handles DST changes).
  const firstGuess = wallAsUtc - zoneOffsetMinutes(new Date(wallAsUtc), timeZone) * MS_PER_MINUTE;
  const secondGuess = wallAsUtc - zoneOffsetMinutes(new Date(firstGuess), timeZone) * MS_PER_MINUTE;
  return new Date(secondGuess);
}

/**
 * Half-open UTC interval `[from, to)` covering local days `startDay..endDay` inclusive,
 * ready for `at >= from && at < to` comparisons on ISO strings.
 */
export function dayRangeToISO(startDay: DayKey, endDay: DayKey, timeZone?: string): { from: ISODate; to: ISODate } {
  return {
    from: startOfDayInstant(startDay, timeZone).toISOString(),
    to: startOfDayInstant(addDays(endDay, 1), timeZone).toISOString(),
  };
}

// ───────── Calendar arithmetic ─────────

export function addDays(day: DayKey, count: number): DayKey {
  return formatCalendarDate(fromUtcMs(utcMs(parseDayKey(day)) + count * MS_PER_DAY));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffDays(from: DayKey, to: DayKey): number {
  return Math.round((utcMs(parseDayKey(to)) - utcMs(parseDayKey(from))) / MS_PER_DAY);
}

/** Adds calendar months, clamping the day (Jan 31 + 1 month → Feb 28/29). */
export function addMonths(day: DayKey, count: number): DayKey {
  const { year, month, day: dayOfMonth } = parseDayKey(day);
  const index = year * 12 + (month - 1) + count;
  const targetYear = Math.floor(index / 12);
  const targetMonth = (index % 12 + 12) % 12 + 1;
  return formatCalendarDate({
    year: targetYear,
    month: targetMonth,
    day: Math.min(dayOfMonth, daysInMonth(targetYear, targetMonth)),
  });
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(day: DayKey): number {
  return (new Date(utcMs(parseDayKey(day))).getUTCDay() + 6) % 7;
}

export function startOfWeek(day: DayKey): DayKey {
  return addDays(day, -weekdayIndex(day));
}

export function endOfWeek(day: DayKey): DayKey {
  return addDays(startOfWeek(day), 6);
}

export function startOfMonth(day: DayKey): DayKey {
  const { year, month } = parseDayKey(day);
  return formatCalendarDate({ year, month, day: 1 });
}

export function endOfMonth(day: DayKey): DayKey {
  const { year, month } = parseDayKey(day);
  return formatCalendarDate({ year, month, day: daysInMonth(year, month) });
}

export function startOfYear(day: DayKey): DayKey {
  return formatCalendarDate({ year: parseDayKey(day).year, month: 1, day: 1 });
}

export function endOfYear(day: DayKey): DayKey {
  return formatCalendarDate({ year: parseDayKey(day).year, month: 12, day: 31 });
}

/** Inclusive range of the day / ISO-style Monday week / month / year containing `day`. */
export function periodRange(period: ReviewPeriod, day: DayKey): DayRange {
  switch (period) {
    case 'day':
      return { startDay: day, endDay: day };
    case 'week':
      return { startDay: startOfWeek(day), endDay: endOfWeek(day) };
    case 'month':
      return { startDay: startOfMonth(day), endDay: endOfMonth(day) };
    case 'year':
      return { startDay: startOfYear(day), endDay: endOfYear(day) };
  }
}

/** The period `count` steps away (negative = earlier) from the one containing `day`. */
export function shiftPeriod(period: ReviewPeriod, day: DayKey, count: number): DayRange {
  switch (period) {
    case 'day':
      return periodRange('day', addDays(day, count));
    case 'week':
      return periodRange('week', addDays(day, count * 7));
    case 'month':
      return periodRange('month', addMonths(startOfMonth(day), count));
    case 'year':
      return periodRange('year', addMonths(startOfYear(day), count * 12));
  }
}

/** Every day from `startDay` to `endDay` inclusive; empty when the range is reversed. */
export function eachDay(startDay: DayKey, endDay: DayKey): DayKey[] {
  const length = diffDays(startDay, endDay) + 1;
  return Array.from({ length: Math.max(0, length) }, (_, index) => addDays(startDay, index));
}

/**
 * Calendar days from today to the local day of `at`: 0 = today, negative = in the past
 * (an overdue commitment due yesterday gives -1).
 */
export function daysUntil(at: DateInput, now: DateInput = new Date(), timeZone?: string): number {
  return diffDays(localDayKey(now, timeZone), localDayKey(at, timeZone));
}

// ───────── Formatting (in the language of the interface) ─────────

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** Day-key formatter pinned to UTC, so a calendar day never shifts with the device's zone. */
function dayFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = `${intlTag()}|${JSON.stringify(options)}`;
  let format = dayFormats.get(cacheKey);
  if (!format) {
    format = new Intl.DateTimeFormat(intlTag(), { ...options, timeZone: 'UTC' });
    dayFormats.set(cacheKey, format);
  }
  return format;
}

/** Removes the " г." that ru-RU appends to a year. */
const withoutYearSuffix = (text: string): string => text.replace(/(?<=\d)\s*г\.$/, '');

function formatDay(day: DayKey, options: Intl.DateTimeFormatOptions): string {
  return withoutYearSuffix(dayFormat(options).format(utcMs(parseDayKey(day))));
}

/** `Wednesday, 7 October` / `среда, 7 октября` */
export function formatDayLong(day: DayKey): string {
  return formatDay(day, { weekday: 'long', day: 'numeric', month: 'long' });
}

/** `7 Oct` / `7 окт.` (with the year when `withYear`) */
export function formatDayShort(day: DayKey, { withYear = false }: { withYear?: boolean } = {}): string {
  return formatDay(day, withYear ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}

/** `Wed, 7 Oct` / `ср, 7 окт.` */
export function formatDayWithWeekday(day: DayKey): string {
  return formatDay(day, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** `Wed` / `ср` */
export function formatWeekdayShort(day: DayKey): string {
  return formatDay(day, { weekday: 'short' });
}

/** `October 2026` / `октябрь 2026` */
export function formatMonthYear(day: DayKey): string {
  return formatDay(day, { month: 'long', year: 'numeric' });
}

/** `October` / `октябрь` */
export function formatMonthName(day: DayKey): string {
  return formatDay(day, { month: 'long' });
}

/** `5–11 October`, `28 Sep – 4 Oct`, `28 Dec 2026 – 3 Jan 2027` (and the Russian equivalents). */
export function formatDayRange(startDay: DayKey, endDay: DayKey): string {
  if (startDay === endDay) return formatDay(startDay, { day: 'numeric', month: 'long' });
  const start = parseDayKey(startDay);
  const end = parseDayKey(endDay);
  if (start.year !== end.year) {
    return `${formatDayShort(startDay, { withYear: true })} – ${formatDayShort(endDay, { withYear: true })}`;
  }
  if (start.month !== end.month) return `${formatDayShort(startDay)} – ${formatDayShort(endDay)}`;
  if (getLocale() === 'ru') return `${start.day}–${formatDay(endDay, { day: 'numeric', month: 'long' })}`;
  return dayFormat({ day: 'numeric', month: 'long' }).formatRange(utcMs(start), utcMs(end));
}

/** `12:30` in the given (or device) time zone. */
export function formatTime(input: DateInput, timeZone?: string): string {
  return new Intl.DateTimeFormat(intlTag(), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).format(toDate(input));
}

/** `today`, `yesterday`, `3 days ago`, `tomorrow`, `in 5 days` (and the Russian equivalents). */
export function relativeDay(day: DayKey, today: DayKey = localDayKey()): string {
  const delta = diffDays(today, day);
  switch (delta) {
    case 0:
      return t('today');
    case -1:
      return t('yesterday');
    case -2:
      return t('the day before yesterday');
    case 1:
      return t('tomorrow');
    case 2:
      return t('the day after tomorrow');
  }
  const count = Math.abs(delta);
  return delta < 0 ? tn(count, '{n} day ago', '{n} days ago') : tn(count, 'in {n} day', 'in {n} days');
}

/** Recording timer: `0:45`, `12:03`, `1:02:03`. */
export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = pad(seconds % 60);
  return hours > 0 ? `${hours}:${pad(minutes)}:${rest}` : `${minutes}:${rest}`;
}

/** Spoken length: `45 s`, `3 min 20 s`, `1 h 5 min`. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) return minutes > 0 ? t('{hours} h {minutes} min', { hours, minutes }) : t('{hours} h', { hours });
  if (minutes > 0) return rest > 0 ? t('{minutes} min {seconds} s', { minutes, seconds: rest }) : t('{minutes} min', { minutes });
  return t('{seconds} s', { seconds: rest });
}
