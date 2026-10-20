import { describe, expect, it } from 'vitest';
import type { Capture, CheckIn, ItemOfKind, Pattern } from '../../domain/types';
import {
  buildDayCells,
  buildDayDetails,
  countDue,
  detectTrend,
  diskMoods,
  diskSegments,
  emptyTimeTitle,
  moodOfCheckIns,
  parseDay,
  parseTab,
  parseView,
  stripDays,
  summarizePeriod,
  topTags,
  ALL_LAYERS,
} from './model';

const cap = (day: string, extra: Partial<Capture> = {}): Capture =>
  ({ id: `c-${day}-${Math.random()}`, kind: 'text', day, text: 'x', createdAt: `${day}T09:00:00.000Z`, updatedAt: '', projectIds: [], personIds: [], tags: [], status: 'done', ...extra }) as Capture;

const ci = (day: string, valence: number, energy: number, extra: Partial<CheckIn> = {}): CheckIn =>
  ({ id: `k-${day}-${Math.random()}`, at: `${day}T10:00:00.000Z`, day, valence, energy, tags: [], origin: 'manual', createdAt: '', updatedAt: '', ...extra }) as CheckIn;

describe('URL parsing', () => {
  it('tab, view and day fall back to safe values', () => {
    expect(parseTab('people')).toBe('people');
    expect(parseTab('nope')).toBe('time');
    expect(parseView('year')).toBe('year');
    expect(parseView(null)).toBe('week');
    expect(parseDay('2026-10-07', '2026-01-01')).toBe('2026-10-07');
    expect(parseDay('2026-02-31', '2026-01-01')).toBe('2026-01-01');
    expect(parseDay('abc', '2026-01-01')).toBe('2026-01-01');
  });
});

describe('cells and layers', () => {
  const captures = [cap('2026-10-05'), cap('2026-10-05'), cap('2026-10-06')];
  const checkIns = [ci('2026-10-05', 0.5, 0.6), ci('2026-10-05', -0.5, 0.4), ci('2026-10-07', 1, 1, { origin: 'ai_suggested' })];

  it('counts records per day and averages confirmed states on the −3…3 scale', () => {
    expect(buildDayCells(captures, checkIns)).toEqual([
      { date: '2026-10-05', count: 2, mood: 0 },
      { date: '2026-10-06', count: 1 },
    ]);
  });

  it('a suggestion that was not confirmed does not colour the day', () => {
    expect(moodOfCheckIns([ci('2026-10-07', 1, 1, { origin: 'ai_suggested' })])).toBeNull();
    expect(moodOfCheckIns([ci('2026-10-07', 1, 1, { origin: 'ai_confirmed' })])).toBe(3);
  });

  it('switched-off layers leave their data out', () => {
    const noState = buildDayCells(captures, checkIns, { ...ALL_LAYERS, state: false });
    expect(noState.every((cell) => cell.mood === undefined)).toBe(true);
    const noRecords = buildDayCells(captures, checkIns, { ...ALL_LAYERS, records: false });
    expect(noRecords).toEqual([{ date: '2026-10-05', mood: 0 }]);
  });
});

describe('period aggregates', () => {
  const captures = [cap('2025-12-31'), cap('2026-01-01'), cap('2026-10-05'), cap('2026-10-05'), cap('2026-10-07'), cap('2026-10-12')];
  const checkIns = [ci('2026-10-05', 1, 0.5), ci('2026-10-07', 0, 0.5)];
  const today = '2026-10-08';

  it('day', () => {
    expect(summarizePeriod('day', '2026-10-05', captures, checkIns, today)).toMatchObject({ records: 2, activeDays: 1, elapsedDays: 1, stateDays: 1, mood: 3 });
  });
  it('week (Monday to Sunday); days after today do not count as elapsed', () => {
    const week = summarizePeriod('week', '2026-10-08', captures, checkIns, today);
    expect(week).toMatchObject({ records: 3, activeDays: 2, elapsedDays: 4, stateDays: 2 });
    expect(week.mood).toBeCloseTo(1.5);
  });
  it('month', () => {
    expect(summarizePeriod('month', '2026-10-08', captures, checkIns, today)).toMatchObject({ records: 4, activeDays: 3, elapsedDays: 8 });
  });
  it('year', () => {
    expect(summarizePeriod('year', '2026-10-08', captures, checkIns, today)).toMatchObject({ records: 5, activeDays: 4 });
  });
  it('a finished period counts all of its days', () => {
    expect(summarizePeriod('month', '2026-01-15', captures, [], today).elapsedDays).toBe(31);
  });
});

describe('«Тренд замечен»', () => {
  const days = (n: number, make: (i: number) => CheckIn) => Array.from({ length: n }, (_, i) => make(i));
  const day = (i: number) => `2026-10-${String(i + 1).padStart(2, '0')}`;

  it('asks for more days instead of guessing', () => {
    expect(detectTrend([ci(day(0), 0, 0.5)], 'week')).toEqual({ kind: 'few', haveDays: 1, needDays: 4 });
  });

  it('names a fall of energy without blame', () => {
    const result = detectTrend(days(6, (i) => ci(day(i), 0.2, i < 3 ? 0.8 : 0.4)), 'week');
    expect(result.kind).toBe('trend');
    if (result.kind !== 'trend') return;
    expect(result.sentences).toHaveLength(1);
    expect(result.sentences[0]).toMatch(/энергии стало меньше/);
    expect(result.sentences[0]).not.toMatch(/!/);
  });

  it('a rise of mood and energy gives at most two sentences', () => {
    const result = detectTrend(days(8, (i) => ci(day(i), i < 4 ? -0.4 : 0.5, i < 4 ? 0.3 : 0.7, { stress: i < 4 ? 0.3 : 0.7 })), 'month');
    expect(result.kind === 'trend' && result.sentences.length).toBe(2);
  });

  it('short sleep against energy', () => {
    const rows = days(8, (i) => ci(day(i), 0.2, i % 2 === 0 ? 0.4 : 0.7, { sleepHours: i % 2 === 0 ? 5 : 8 }));
    const result = detectTrend(rows, 'week');
    expect(result.kind === 'trend' && result.sentences.some((s) => /сна меньше 6,5 часов/.test(s))).toBe(true);
  });

  it('a calm period is said to be calm', () => {
    expect(detectTrend(days(6, (i) => ci(day(i), 0.2, 0.5)), 'week').kind).toBe('steady');
  });

  it('suggested states are not used', () => {
    expect(detectTrend(days(6, (i) => ci(day(i), 0.2, 0.5, { origin: 'ai_suggested' })), 'week').kind).toBe('few');
  });
});

describe('tags', () => {
  it('counts records and states together, case-insensitively, most used first', () => {
    const tags = topTags([cap('2026-10-01', { tags: ['Деньги', 'сон'] }), cap('2026-10-02', { tags: ['деньги'] })], [ci('2026-10-01', 0, 0.5, { tags: ['Сон', 'Люди'] })]);
    expect(tags).toEqual([
      { tag: 'Деньги', count: 2 },
      { tag: 'Сон', count: 2 },
      { tag: 'Люди', count: 1 },
    ]);
  });
});

describe('the day', () => {
  const commitment = (dueAt: string): ItemOfKind<'commitment'> =>
    ({ id: `i-${dueAt}`, kind: 'commitment', status: 'active', title: 'Позвонить', direction: 'i_owe', dueAt, personIds: [], projectIds: [], tags: [], createdAt: '', updatedAt: '' }) as ItemOfKind<'commitment'>;
  const c1 = cap('2026-10-05', { id: 'c1', title: 'Запись один' });
  const pattern = { id: 'p1', title: 'Откладываю', status: 'candidate', evidence: [{ captureId: 'c1', day: '2026-10-05' }] } as Pattern;

  it('collects records, states, deadlines and patterns of the day', () => {
    const due = commitment(new Date(2026, 9, 5, 18, 0).toISOString());
    const details = buildDayDetails('2026-10-05', [c1, cap('2026-10-06')], [ci('2026-10-05', 0, 0.5)], [], [due, commitment(new Date(2026, 9, 9).toISOString())], [pattern]);
    expect(details.captures.map((c) => c.id)).toEqual(['c1']);
    expect(details.checkIns).toHaveLength(1);
    expect(details.due).toHaveLength(1);
    expect(details.patterns).toHaveLength(1);
    expect(countDue([due], { startDay: '2026-10-01', endDay: '2026-10-31' })).toBe(1);
  });

  it('the disk draws the layers that are on', () => {
    const due = commitment(new Date(2026, 9, 5, 18, 0).toISOString());
    const details = buildDayDetails('2026-10-05', [c1], [ci('2026-10-05', 0.5, 0.5)], [], [due], [pattern]);
    const all = diskSegments(details, ALL_LAYERS);
    expect(all.map((s) => s.kind).sort()).toEqual(['commitment', 'pattern']);
    expect(diskSegments(details, { ...ALL_LAYERS, patterns: false }).map((s) => s.kind).sort()).toEqual(['commitment', 'fact']);
    expect(diskSegments(details, { state: true, records: false, commitments: false, patterns: false })).toEqual([]);
    expect(diskMoods(details.checkIns)).toHaveLength(1);
  });

  it('the strip holds three weeks round the day', () => {
    const strip = stripDays('2026-10-08');
    expect(strip).toHaveLength(21);
    expect(strip[0]).toBe('2026-09-28');
    expect(strip[20]).toBe('2026-10-18');
  });

  it('the empty state counts the days still needed', () => {
    expect(emptyTimeTitle('week', 1)).toBe('Картина недели появится через 2 дня записей.');
    expect(emptyTimeTitle('month', 2)).toBe('Картина месяца появится через 1 день записей.');
  });
});
