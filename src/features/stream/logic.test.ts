import { describe, expect, it } from 'vitest';
import type { CaptureDayGroup } from '../../db/repos/captures';
import type { Capture, Item } from '../../domain/types';
import { dayHeading, dayPartOfMinutes } from './dayparts';
import {
  NO_FILTERS,
  countSheetFilters,
  filtersToParams,
  groupItemsByCapture,
  matchesFilters,
  parseFilters,
  periodFromDay,
} from './filters';
import { captureSummary, captureTitle, decorativePeaks, inboxAction, objectChips, rowMeta, statusLabel } from './rowModel';
import { VIRTUALIZE_FROM, buildStreamRows } from './rows';
import { computeWindow } from './virtual';

const TODAY = '2026-10-07';

function capture(id: string, createdAt: string, patch: Partial<Capture> = {}): Capture {
  return {
    id,
    createdAt,
    updatedAt: createdAt,
    kind: 'voice',
    day: createdAt.slice(0, 10),
    text: 'Текст записи',
    projectIds: [],
    personIds: [],
    tags: [],
    status: 'done',
    ...patch,
  };
}

function item(id: string, captureId: string | undefined, patch: Partial<Item> = {}): Item {
  return {
    id,
    captureId,
    kind: 'task',
    status: 'active',
    title: `Объект ${id}`,
    createdAt: `2026-10-07T10:00:00.${id.padStart(3, '0').slice(-3)}Z`,
    updatedAt: '2026-10-07T10:00:00.000Z',
    personIds: [],
    projectIds: [],
    tags: [],
    ...patch,
  } as Item;
}

describe('parts of the day', () => {
  it('splits the day at 05:00, 12:00 and 18:00', () => {
    expect(dayPartOfMinutes(0)).toBe('night');
    expect(dayPartOfMinutes(4 * 60 + 59)).toBe('night');
    expect(dayPartOfMinutes(5 * 60)).toBe('morning');
    expect(dayPartOfMinutes(11 * 60 + 59)).toBe('morning');
    expect(dayPartOfMinutes(12 * 60)).toBe('day');
    expect(dayPartOfMinutes(17 * 60 + 59)).toBe('day');
    expect(dayPartOfMinutes(18 * 60)).toBe('evening');
    expect(dayPartOfMinutes(23 * 60 + 59)).toBe('evening');
  });

  it('names today and yesterday and dates the rest', () => {
    expect(dayHeading('2026-10-07', TODAY)).toEqual({ title: 'Сегодня', subtitle: expect.stringContaining('7 октября') });
    expect(dayHeading('2026-10-06', TODAY).title).toBe('Вчера');
    expect(dayHeading('2026-10-01', TODAY)).toEqual({ title: expect.stringContaining('1 окт') });
    expect(dayHeading('2025-12-31', TODAY).title).toContain('2025');
  });
});

describe('buildStreamRows', () => {
  // Times are local to the test machine's zone: build them from local components.
  const at = (day: string, hour: number, minute = 0): string => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return new Date(y, m - 1, d, hour, minute).toISOString();
  };

  it('puts a day heading, then a label for each stretch of the day, then its records (newest first)', () => {
    const groups: CaptureDayGroup[] = [
      { day: '2026-10-07', captures: [capture('c4', at('2026-10-07', 20)), capture('c3', at('2026-10-07', 14)), capture('c2', at('2026-10-07', 9)), capture('c1', at('2026-10-07', 8))] },
      { day: '2026-10-06', captures: [capture('c0', at('2026-10-06', 13))] },
    ];
    const rows = buildStreamRows(groups, TODAY);
    expect(rows.map((row) => (row.type === 'capture' ? row.capture.id : row.type === 'part' ? row.label : `# ${row.day}`))).toEqual([
      '# 2026-10-07',
      'Вечер',
      'c4',
      'День',
      'c3',
      'Утро',
      'c2',
      'c1',
      '# 2026-10-06',
      'День',
      'c0',
    ]);
    expect(rows[0]).toMatchObject({ type: 'day', count: 4 });
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it('skips empty days and handles no days at all', () => {
    expect(buildStreamRows([], TODAY)).toEqual([]);
    expect(buildStreamRows([{ day: '2026-10-07', captures: [] }], TODAY)).toEqual([]);
  });

  it('virtualizes from 200 lines', () => {
    expect(VIRTUALIZE_FROM).toBe(200);
  });
});

describe('filters', () => {
  const items = groupItemsByCapture([
    item('1', 'a', { kind: 'decision' }),
    item('2', 'a', { kind: 'idea' }),
    item('3', 'b', { kind: 'task', status: 'dismissed' }),
    item('4', undefined, { kind: 'task' }),
  ]);

  it('groups objects by record and leaves out dismissed ones and orphans', () => {
    expect([...items.keys()]).toEqual(['a']);
    expect(items.get('a')?.map((i) => i.kind)).toEqual(['decision', 'idea']);
  });

  it('computes the first day of a period, today included', () => {
    expect(periodFromDay('all', TODAY)).toBeUndefined();
    expect(periodFromDay('week', TODAY)).toBe('2026-10-01');
    expect(periodFromDay('month', TODAY)).toBe('2026-09-08');
    expect(periodFromDay('quarter', TODAY)).toBe('2026-07-10');
  });

  it('filters by type through the objects found in the record', () => {
    const a = capture('a', '2026-10-07T10:00:00.000Z');
    const b = capture('b', '2026-10-07T11:00:00.000Z');
    expect(matchesFilters(a, items, { ...NO_FILTERS, type: 'decision' }, TODAY)).toBe(true);
    expect(matchesFilters(a, items, { ...NO_FILTERS, type: 'prediction' }, TODAY)).toBe(false);
    // A dismissed object does not make its record a "task" record.
    expect(matchesFilters(b, items, { ...NO_FILTERS, type: 'task' }, TODAY)).toBe(false);
    expect(matchesFilters(b, items, NO_FILTERS, TODAY)).toBe(true);
  });

  it('filters by person, project and period together', () => {
    const c = capture('c', '2026-09-20T10:00:00.000Z', { personIds: ['p1'], projectIds: ['pr1'] });
    expect(matchesFilters(c, items, { period: 'all', personId: 'p1', projectId: 'pr1' }, TODAY)).toBe(true);
    expect(matchesFilters(c, items, { period: 'all', personId: 'p2' }, TODAY)).toBe(false);
    expect(matchesFilters(c, items, { period: 'all', projectId: 'pr2' }, TODAY)).toBe(false);
    expect(matchesFilters(c, items, { period: 'week' }, TODAY)).toBe(false);
    expect(matchesFilters(c, items, { period: 'month' }, TODAY)).toBe(true);
  });

  it('round-trips through the address and ignores junk', () => {
    const filters = { type: 'idea', personId: 'p1', projectId: 'pr1', period: 'month' } as const;
    const params = filtersToParams(filters, new URLSearchParams('q=1'));
    expect(params.get('q')).toBe('1');
    expect(parseFilters(params)).toEqual(filters);
    expect(parseFilters(new URLSearchParams('type=nonsense&period=forever'))).toEqual(NO_FILTERS);
    expect(filtersToParams(NO_FILTERS).toString()).toBe('');
    expect(countSheetFilters(filters)).toBe(3);
  });
});

describe('row model', () => {
  it('takes the title from the record, else from the first line of the text', () => {
    expect(captureTitle({ kind: 'voice', text: 'x', title: '  Идея про интенсив ' })).toBe('Идея про интенсив');
    expect(captureTitle({ kind: 'text', text: '\n\nПервая строка\nвторая' })).toBe('Первая строка');
    expect(captureTitle({ kind: 'voice', text: '' })).toBe('Голосовая запись');
    expect(captureTitle({ kind: 'text', text: '  ' })).toBe('Запись без текста');
    expect(captureTitle({ kind: 'text', text: 'а'.repeat(200) }).length).toBeLessThanOrEqual(70);
  });

  it('shows the summary, or an excerpt when there is a title but no summary, and nothing when the title is the text', () => {
    expect(captureSummary({ title: 'T', summary: 'Кратко', text: 'Длинно' })).toBe('Кратко');
    expect(captureSummary({ title: 'T', text: 'Длинный\nтекст' })).toBe('Длинный текст');
    expect(captureSummary({ text: 'Просто текст' })).toBeUndefined();
  });

  it('puts objects waiting for review first and counts the rest', () => {
    const items = [item('1', 'a', { title: 'Первое' }), item('2', 'a', { title: 'Второе', status: 'proposed' }), item('3', 'a'), item('4', 'a')];
    const { chips, more } = objectChips(items);
    expect(chips.map((chip) => chip.title)).toEqual(['Второе', 'Первое', 'Объект 3']);
    expect(chips[0]?.proposed).toBe(true);
    expect(more).toBe(1);
    expect(objectChips(undefined)).toEqual({ chips: [], more: 0 });
  });

  it('offers the right action for each unfinished status', () => {
    expect(inboxAction('raw')).toBe('process');
    expect(inboxAction('transcribed')).toBe('process');
    expect(inboxAction('failed')).toBe('retry');
    expect(inboxAction('review')).toBe('review');
    expect(inboxAction('transcribing')).toBe('busy');
    expect(inboxAction('extracting')).toBe('busy');
    expect(inboxAction('done')).toBeNull();
    expect(inboxAction('skipped')).toBeNull();
    expect(statusLabel('done')).toBeUndefined();
    expect(statusLabel('failed')).toBe('Не удалось обработать');
  });

  it('formats time and length', () => {
    const meta = rowMeta({ kind: 'voice', createdAt: new Date(2026, 9, 7, 14, 5).toISOString(), durationSec: 72 });
    expect(meta).toBe('14:05 · 1 мин 12 с');
    expect(rowMeta({ kind: 'text', createdAt: new Date(2026, 9, 7, 9, 30).toISOString() })).toBe('09:30');
  });

  it('draws the same decorative capsule for the same record, always within 0..1', () => {
    const a = decorativePeaks('id-1');
    expect(decorativePeaks('id-1')).toEqual(a);
    expect(decorativePeaks('id-2')).not.toEqual(a);
    expect(a).toHaveLength(24);
    expect(a.every((v) => v > 0 && v <= 1)).toBe(true);
  });
});

describe('computeWindow', () => {
  const heights = Array.from({ length: 1000 }, () => 100);

  it('renders the rows near the viewport and pads the rest', () => {
    const w = computeWindow(heights, 5000, 800, 200);
    // Visible range is 4800..6000 → rows 48..59.
    expect(w.start).toBe(48);
    expect(w.end).toBe(60);
    expect(w.before).toBe(4800);
    expect(w.after).toBe(100_000 - 6000);
    expect(w.total).toBe(100_000);
  });

  it('starts at the top and clamps at the bottom', () => {
    expect(computeWindow(heights, 0, 800, 200)).toMatchObject({ start: 0, end: 10, before: 0 });
    const end = computeWindow(heights, 99_500, 800, 200);
    expect(end.end).toBe(1000);
    expect(end.after).toBe(0);
  });

  it('copes with rows of different heights and with nothing to show', () => {
    const w = computeWindow([50, 300, 50, 50], 340, 10, 0);
    expect(w.start).toBe(1);
    expect(w.end).toBe(2);
    expect(computeWindow([], 0, 800)).toEqual({ start: 0, end: 0, before: 0, after: 0, total: 0 });
  });

  it('always keeps at least one row when the viewport is past the end', () => {
    const w = computeWindow([100, 100], 5000, 800, 0);
    expect(w.end - w.start).toBeGreaterThanOrEqual(1);
  });
});
