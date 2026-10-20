import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayRangeToISO,
  daysUntil,
  diffDays,
  eachDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  formatClock,
  formatDayLong,
  formatDayRange,
  formatDayShort,
  formatDayWithWeekday,
  formatDuration,
  formatMonthName,
  formatMonthYear,
  formatTime,
  formatWeekdayShort,
  isDayKey,
  localDayKey,
  localMinutesOfDay,
  nowISO,
  periodRange,
  relativeDay,
  shiftPeriod,
  startOfDayInstant,
  startOfMonth,
  startOfWeek,
  startOfYear,
  weekdayIndex,
} from './dates';

const MOSCOW = 'Europe/Moscow'; // UTC+3, no DST
const LOS_ANGELES = 'America/Los_Angeles'; // UTC-7 in October, DST
const KOLKATA = 'Asia/Kolkata'; // UTC+5:30
const BERLIN = 'Europe/Berlin';

const hoursBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 3_600_000;

describe('localDayKey', () => {
  it('moves the day forward east of Greenwich after UTC evening', () => {
    expect(localDayKey('2026-10-07T21:30:00Z', MOSCOW)).toBe('2026-10-08');
    expect(localDayKey('2026-10-07T21:30:00Z', 'UTC')).toBe('2026-10-07');
  });

  it('keeps the previous day west of Greenwich', () => {
    expect(localDayKey('2026-10-07T03:00:00Z', LOS_ANGELES)).toBe('2026-10-06');
    expect(localDayKey('2026-10-07T21:30:00Z', LOS_ANGELES)).toBe('2026-10-07');
  });

  it('switches exactly at local midnight, including half-hour offsets', () => {
    expect(localDayKey('2026-10-07T18:29:59Z', KOLKATA)).toBe('2026-10-07');
    expect(localDayKey('2026-10-07T18:30:00Z', KOLKATA)).toBe('2026-10-08');
    expect(localDayKey('2026-10-07T20:59:59.999Z', MOSCOW)).toBe('2026-10-07');
    expect(localDayKey('2026-10-07T21:00:00.000Z', MOSCOW)).toBe('2026-10-08');
  });

  it('handles the extreme UTC offsets', () => {
    expect(localDayKey('2026-10-07T00:00:00Z', 'Pacific/Kiritimati')).toBe('2026-10-07'); // +14
    expect(localDayKey('2026-10-07T00:00:00Z', 'Pacific/Pago_Pago')).toBe('2026-10-06'); // -11
  });

  it('rolls over the year', () => {
    expect(localDayKey('2026-12-31T23:30:00Z', MOSCOW)).toBe('2027-01-01');
    expect(localDayKey('2027-01-01T01:00:00Z', LOS_ANGELES)).toBe('2026-12-31');
  });

  it('accepts dates, ISO strings and timestamps', () => {
    const iso = '2026-10-07T12:00:00Z';
    expect(localDayKey(new Date(iso), 'UTC')).toBe('2026-10-07');
    expect(localDayKey(Date.parse(iso), 'UTC')).toBe('2026-10-07');
  });

  it('uses the device zone without an explicit one', () => {
    expect(localDayKey(new Date(2026, 9, 7, 23, 59, 59))).toBe('2026-10-07');
    expect(localDayKey(new Date(2026, 9, 8, 0, 0, 0))).toBe('2026-10-08');
  });

  it('rejects an invalid date', () => {
    expect(() => localDayKey('not a date')).toThrow(RangeError);
  });
});

describe('startOfDayInstant and dayRangeToISO', () => {
  it('finds local midnight in fixed-offset zones', () => {
    expect(startOfDayInstant('2026-10-08', MOSCOW).toISOString()).toBe('2026-10-07T21:00:00.000Z');
    expect(startOfDayInstant('2026-10-08', KOLKATA).toISOString()).toBe('2026-10-07T18:30:00.000Z');
    expect(startOfDayInstant('2026-10-08', 'Asia/Kathmandu').toISOString()).toBe('2026-10-07T18:15:00.000Z');
    expect(startOfDayInstant('2026-10-08', 'UTC').toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });

  it('round-trips with localDayKey at the exact boundary', () => {
    for (const zone of [MOSCOW, LOS_ANGELES, KOLKATA, BERLIN, 'Pacific/Kiritimati']) {
      const start = startOfDayInstant('2026-10-08', zone);
      expect(localDayKey(start, zone)).toBe('2026-10-08');
      expect(localDayKey(new Date(start.getTime() - 1), zone)).toBe('2026-10-07');
    }
  });

  it('makes the day 23 hours long when clocks spring forward', () => {
    const start = startOfDayInstant('2026-03-29', BERLIN);
    const next = startOfDayInstant('2026-03-30', BERLIN);
    expect(start.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(next.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(hoursBetween(start, next)).toBe(23);
    expect(hoursBetween(startOfDayInstant('2026-03-08', LOS_ANGELES), startOfDayInstant('2026-03-09', LOS_ANGELES))).toBe(23);
  });

  it('makes the day 25 hours long when clocks fall back', () => {
    const start = startOfDayInstant('2026-10-25', BERLIN);
    const next = startOfDayInstant('2026-10-26', BERLIN);
    expect(start.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(next.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(hoursBetween(start, next)).toBe(25);
  });

  it('uses the device zone without an explicit one', () => {
    expect(startOfDayInstant('2026-10-07').getTime()).toBe(new Date(2026, 9, 7).getTime());
  });

  it('builds a half-open UTC interval over whole local days', () => {
    expect(dayRangeToISO('2026-10-05', '2026-10-11', MOSCOW)).toEqual({
      from: '2026-10-04T21:00:00.000Z',
      to: '2026-10-11T21:00:00.000Z',
    });
    expect(dayRangeToISO('2026-10-25', '2026-10-25', BERLIN)).toEqual({
      from: '2026-10-24T22:00:00.000Z',
      to: '2026-10-25T23:00:00.000Z',
    });
  });

  it('rejects a malformed day key', () => {
    expect(() => startOfDayInstant('2026-02-30')).toThrow(RangeError);
  });
});

describe('localMinutesOfDay', () => {
  it('returns wall-clock minutes in the zone', () => {
    expect(localMinutesOfDay('2026-10-07T21:05:00Z', MOSCOW)).toBe(5);
    expect(localMinutesOfDay('2026-10-07T12:30:00Z', 'UTC')).toBe(12 * 60 + 30);
    expect(localMinutesOfDay('2026-10-07T18:30:00Z', KOLKATA)).toBe(0);
    expect(localMinutesOfDay(new Date(2026, 9, 7, 23, 59))).toBe(23 * 60 + 59);
  });
});

describe('day key validation', () => {
  it('accepts real calendar days only', () => {
    expect(isDayKey('2026-10-07')).toBe(true);
    expect(isDayKey('2028-02-29')).toBe(true);
    expect(isDayKey('2026-02-29')).toBe(false);
    expect(isDayKey('2026-02-30')).toBe(false);
    expect(isDayKey('2026-13-01')).toBe(false);
    expect(isDayKey('2026-00-10')).toBe(false);
    expect(isDayKey('2026-1-1')).toBe(false);
    expect(isDayKey('2026-10-07T00:00:00Z')).toBe(false);
  });
});

describe('calendar arithmetic', () => {
  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-10-07', 1)).toBe('2026-10-08');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-07', 0)).toBe('2026-10-07');
    expect(addDays('2026-10-07', 365)).toBe('2027-10-07');
  });

  it('counts whole days regardless of DST', () => {
    expect(diffDays('2026-10-07', '2026-10-07')).toBe(0);
    expect(diffDays('2026-10-07', '2026-10-10')).toBe(3);
    expect(diffDays('2026-10-10', '2026-10-07')).toBe(-3);
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
  });

  it('adds months and clamps to the last day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
    expect(addMonths('2026-01-15', -13)).toBe('2024-12-15');
    expect(addMonths('2026-06-10', 24)).toBe('2028-06-10');
  });

  it('numbers weekdays from Monday', () => {
    expect(weekdayIndex('2026-10-05')).toBe(0); // Monday
    expect(weekdayIndex('2026-10-07')).toBe(2); // Wednesday
    expect(weekdayIndex('2026-10-11')).toBe(6); // Sunday
  });
});

describe('week, month and year bounds', () => {
  it('starts the week on Monday', () => {
    expect(startOfWeek('2026-10-07')).toBe('2026-10-05');
    expect(startOfWeek('2026-10-05')).toBe('2026-10-05');
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05'); // Sunday belongs to the week that began on Monday
    expect(endOfWeek('2026-10-07')).toBe('2026-10-11');
    expect(endOfWeek('2026-10-11')).toBe('2026-10-11');
  });

  it('crosses month and year boundaries', () => {
    expect(startOfWeek('2026-11-01')).toBe('2026-10-26');
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28');
    expect(endOfWeek('2026-12-30')).toBe('2027-01-03');
  });

  it('finds month and year bounds, leap years included', () => {
    expect(startOfMonth('2026-10-07')).toBe('2026-10-01');
    expect(endOfMonth('2026-10-07')).toBe('2026-10-31');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
    expect(endOfMonth('2026-04-01')).toBe('2026-04-30');
    expect(startOfYear('2026-10-07')).toBe('2026-01-01');
    expect(endOfYear('2026-10-07')).toBe('2026-12-31');
  });

  it('builds the range of every period', () => {
    expect(periodRange('day', '2026-10-07')).toEqual({ startDay: '2026-10-07', endDay: '2026-10-07' });
    expect(periodRange('week', '2026-10-07')).toEqual({ startDay: '2026-10-05', endDay: '2026-10-11' });
    expect(periodRange('month', '2026-10-07')).toEqual({ startDay: '2026-10-01', endDay: '2026-10-31' });
    expect(periodRange('year', '2026-10-07')).toEqual({ startDay: '2026-01-01', endDay: '2026-12-31' });
  });

  it('shifts periods in both directions', () => {
    expect(shiftPeriod('day', '2026-10-07', -1)).toEqual({ startDay: '2026-10-06', endDay: '2026-10-06' });
    expect(shiftPeriod('week', '2026-10-07', -1)).toEqual({ startDay: '2026-09-28', endDay: '2026-10-04' });
    expect(shiftPeriod('week', '2026-10-07', 1)).toEqual({ startDay: '2026-10-12', endDay: '2026-10-18' });
    expect(shiftPeriod('month', '2026-01-31', -1)).toEqual({ startDay: '2025-12-01', endDay: '2025-12-31' });
    expect(shiftPeriod('month', '2026-01-31', 1)).toEqual({ startDay: '2026-02-01', endDay: '2026-02-28' });
    expect(shiftPeriod('year', '2026-06-01', 1)).toEqual({ startDay: '2027-01-01', endDay: '2027-12-31' });
    expect(shiftPeriod('year', '2026-06-01', 0)).toEqual(periodRange('year', '2026-06-01'));
  });

  it('lists days inclusively', () => {
    expect(eachDay('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(eachDay('2026-10-07', '2026-10-07')).toEqual(['2026-10-07']);
    expect(eachDay('2026-10-08', '2026-10-07')).toEqual([]);
    expect(eachDay('2026-01-01', '2026-12-31')).toHaveLength(365);
  });
});

describe('daysUntil', () => {
  it('compares local calendar days, not 24-hour spans', () => {
    const now = '2026-10-07T21:30:00Z'; // already 8 Oct in Moscow
    expect(daysUntil('2026-10-08T05:00:00Z', now, MOSCOW)).toBe(0);
    expect(daysUntil('2026-10-08T05:00:00Z', now, 'UTC')).toBe(1);
    expect(daysUntil('2026-10-05T12:00:00Z', now, 'UTC')).toBe(-2);
    expect(daysUntil('2026-10-14T12:00:00Z', now, 'UTC')).toBe(7);
  });
});

describe('relativeDay', () => {
  const today = '2026-10-07';

  it('names the close days', () => {
    expect(relativeDay('2026-10-07', today)).toBe('сегодня');
    expect(relativeDay('2026-10-06', today)).toBe('вчера');
    expect(relativeDay('2026-10-05', today)).toBe('позавчера');
    expect(relativeDay('2026-10-08', today)).toBe('завтра');
    expect(relativeDay('2026-10-09', today)).toBe('послезавтра');
  });

  it('declines "день" after the number', () => {
    expect(relativeDay('2026-10-04', today)).toBe('3 дня назад');
    expect(relativeDay('2026-10-02', today)).toBe('5 дней назад');
    expect(relativeDay('2026-09-26', today)).toBe('11 дней назад');
    expect(relativeDay('2026-09-16', today)).toBe('21 день назад');
    expect(relativeDay('2026-09-15', today)).toBe('22 дня назад');
    expect(relativeDay('2026-10-10', today)).toBe('через 3 дня');
    expect(relativeDay('2026-10-12', today)).toBe('через 5 дней');
    expect(relativeDay('2026-10-28', today)).toBe('через 21 день');
  });

  it('defaults to the device-local today', () => {
    expect(relativeDay(localDayKey())).toBe('сегодня');
  });
});

describe('Russian formatting', () => {
  it('formats days', () => {
    expect(formatDayLong('2026-10-07')).toBe('среда, 7 октября');
    expect(formatDayShort('2026-10-07')).toBe('7 окт.');
    expect(formatDayShort('2026-10-07', { withYear: true })).toBe('7 окт. 2026');
    // «авг.» ends in the same letters as the year suffix « г.», which must not be cut.
    expect(formatDayShort('2026-08-27')).toBe('27 авг.');
    expect(formatDayShort('2026-08-27', { withYear: true })).toBe('27 авг. 2026');
    expect(formatDayWithWeekday('2026-10-07')).toBe('ср, 7 окт.');
    expect(formatWeekdayShort('2026-10-11')).toBe('вс');
    expect(formatMonthYear('2026-10-07')).toBe('октябрь 2026');
    expect(formatMonthName('2026-03-01')).toBe('март');
  });

  it('formats ranges compactly', () => {
    expect(formatDayRange('2026-10-05', '2026-10-11')).toBe('5–11 октября');
    expect(formatDayRange('2026-09-28', '2026-10-04')).toBe('28 сент. – 4 окт.');
    expect(formatDayRange('2026-12-28', '2027-01-03')).toBe('28 дек. 2026 – 3 янв. 2027');
    expect(formatDayRange('2026-10-07', '2026-10-07')).toBe('7 октября');
  });

  it('formats the time of day in 24-hour form', () => {
    expect(formatTime('2026-10-07T12:30:00Z', 'UTC')).toBe('12:30');
    expect(formatTime('2026-10-07T12:30:00Z', MOSCOW)).toBe('15:30');
    expect(formatTime('2026-10-07T21:05:00Z', MOSCOW)).toBe('00:05');
    expect(formatTime(new Date(2026, 9, 7, 9, 5))).toBe('09:05');
  });

  it('formats the recording clock', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(45)).toBe('0:45');
    expect(formatClock(723)).toBe('12:03');
    expect(formatClock(3723)).toBe('1:02:03');
    expect(formatClock(-5)).toBe('0:00');
    expect(formatClock(59.9)).toBe('0:59');
  });

  it('formats spoken durations', () => {
    expect(formatDuration(45)).toBe('45 с');
    expect(formatDuration(180)).toBe('3 мин');
    expect(formatDuration(200)).toBe('3 мин 20 с');
    expect(formatDuration(3900)).toBe('1 ч 5 мин');
    expect(formatDuration(7200)).toBe('2 ч');
  });
});

describe('nowISO', () => {
  it('returns a UTC ISO string for the current moment', () => {
    const before = Date.now();
    const value = nowISO();
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(value)).toBeGreaterThanOrEqual(before);
  });
});
