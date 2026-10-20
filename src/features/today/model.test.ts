import { describe, expect, it } from 'vitest';
import { addDays, localDayKey } from '../../domain/dates';
import type { Capture, CheckIn, ItemOfKind } from '../../domain/types';
import { MAX_BURNING_ROWS, buildTodayModel, countsForMood, dueLabel } from './model';
import type { TodaySnapshot } from './snapshot';

const DAY = '2026-10-07';
const at = (day: string, time: string): string => new Date(`${day}T${time}:00`).toISOString();
const base = { createdAt: at(DAY, '08:00'), updatedAt: at(DAY, '08:00') };

function capture(id: string, time: string, extra: Partial<Capture> = {}): Capture {
  return { ...base, id, kind: 'voice', day: DAY, text: `текст ${id}`, projectIds: [], personIds: [], tags: [], status: 'done', createdAt: at(DAY, time), ...extra };
}

function checkIn(id: string, valence: number, extra: Partial<CheckIn> = {}): CheckIn {
  return { ...base, id, at: at(DAY, '12:00'), day: DAY, valence, energy: 0.5, tags: [], origin: 'manual', ...extra };
}

function commitment(id: string, dueDay: string | undefined, extra: Partial<ItemOfKind<'commitment'>> = {}): ItemOfKind<'commitment'> {
  return {
    ...base,
    id,
    kind: 'commitment',
    status: 'active',
    title: `Обещание ${id}`,
    personIds: [],
    projectIds: [],
    tags: [],
    direction: 'i_owe',
    ...(dueDay && { dueAt: at(dueDay, '12:00') }),
    ...extra,
  };
}

function snapshot(extra: Partial<TodaySnapshot> = {}): TodaySnapshot {
  return {
    day: DAY,
    captures: [],
    items: [],
    checkIns: [],
    commitments: [],
    predictions: [],
    decisions: [],
    peopleNames: {},
    pattern: null,
    review: null,
    dayReview: null,
    recordsTotal: 0,
    ...extra,
  };
}

describe('dueLabel', () => {
  it('says lateness in words', () => {
    expect(dueLabel(at('2026-10-05', '12:00'), DAY)).toEqual({ text: 'просрочено на 2 дня', overdue: true });
    expect(dueLabel(at('2026-09-26', '12:00'), DAY)).toEqual({ text: 'просрочено на 11 дней', overdue: true });
    expect(dueLabel(at(DAY, '23:00'), DAY)).toEqual({ text: 'сегодня', overdue: false });
    expect(dueLabel(at(addDays(DAY, 1), '09:00'), DAY)).toEqual({ text: 'завтра', overdue: false });
  });
});

describe('buildTodayModel', () => {
  it('is a quiet day with no mood for a user with nothing', () => {
    const model = buildTodayModel(snapshot());
    expect(model.verdict).toBe('Тихий день');
    expect(model.mood).toBeNull();
    expect(model.auraMood).toBeNull();
    expect(model.burningCount).toBe(0);
    expect(model.isFresh).toBe(true);
  });

  it('is not fresh once any record exists, even if today is empty', () => {
    expect(buildTodayModel(snapshot({ recordsTotal: 4 })).isFresh).toBe(false);
  });

  it('averages the state of the day for the planet and the aura, ignoring AI suggestions', () => {
    const model = buildTodayModel(
      snapshot({
        checkIns: [checkIn('a', 1), checkIn('b', 0.5), checkIn('c', -1, { origin: 'ai_suggested' })],
      }),
    );
    expect(model.mood).toBeCloseTo(2.25);
    expect(model.auraMood).toBeCloseTo(0.75);
    expect(model.moodLabel).toBe('Приятно');
    expect(model.suggested.map((entry) => entry.id)).toEqual(['c']);
    expect(countsForMood(checkIn('d', 0, { origin: 'ai_confirmed' }))).toBe(true);
  });

  it('puts records and loose check-ins on the ring, coloured by what was extracted', () => {
    const model = buildTodayModel(
      snapshot({
        captures: [capture('c1', '09:30', { title: 'Про интенсив' }), capture('c2', '14:15'), capture('c3', '18:00', { kind: 'checkin' })],
        items: [
          { ...commitment('i1', undefined, { captureId: 'c1' }) },
          { ...base, id: 'i2', kind: 'decision', status: 'active', title: 'Решил', personIds: [], projectIds: [], tags: [], captureId: 'c1', chosen: 'да', alternatives: [], reasons: [] },
        ],
        checkIns: [checkIn('k1', 0.3), checkIn('k2', 0.3, { captureId: 'c3' })],
      }),
    );
    const byId = Object.fromEntries(model.entries.map((entry) => [entry.id, entry]));
    expect(byId.c1).toMatchObject({ minutes: 9 * 60 + 30, kind: 'decision', label: 'Про интенсив' });
    expect(byId.c2).toMatchObject({ minutes: 14 * 60 + 15, kind: 'fact' });
    expect(byId.c3?.kind).toBe('state');
    // A check-in tied to a record is already on the ring through that record.
    expect(model.entries.filter((entry) => entry.id.startsWith('checkin:')).map((entry) => entry.id)).toEqual(['checkin:k1']);
  });

  it('counts decisions and ideas for the verdict', () => {
    const decision = (id: string) => ({ ...base, id, kind: 'decision' as const, status: 'active' as const, title: id, personIds: [], projectIds: [], tags: [], chosen: 'x', alternatives: [], reasons: [] });
    const model = buildTodayModel(snapshot({ captures: [capture('c1', '10:00')], items: [decision('d1'), decision('d2'), decision('d3')] }));
    expect(model.counts.decisions).toBe(3);
    expect(model.verdict).toBe('День решений');
  });

  it('lets only my overdue promises set the verdict, and lists every open commitment as a satellite', () => {
    const model = buildTodayModel(
      snapshot({
        captures: [capture('c1', '10:00')],
        commitments: [
          commitment('late', addDays(DAY, -3)),
          commitment('theirs', addDays(DAY, -9), { direction: 'owed_to_me' }),
          commitment('later', addDays(DAY, 5)),
        ],
      }),
    );
    expect(model.counts.overdue).toBe(1);
    expect(model.verdict).toBe('Есть долги по обещаниям');
    expect(model.satellites.map((s) => [s.id, s.overdue])).toEqual([
      ['late', true],
      ['theirs', true],
      ['later', false],
    ]);
    expect(model.satellites[2]?.dueLabel).toBe('через 5 дней');

    const onlyTheirs = buildTodayModel(snapshot({ captures: [capture('c1', '10:00')], commitments: [commitment('theirs', addDays(DAY, -9), { direction: 'owed_to_me' })] }));
    expect(onlyTheirs.counts.overdue).toBe(0);
    expect(onlyTheirs.verdict).toBe('Среда, 7 октября');
  });

  it('builds "Горит сегодня": overdue mine, due today, predictions, decisions; at most three rows', () => {
    const prediction: ItemOfKind<'prediction'> = {
      ...base,
      id: 'p1',
      kind: 'prediction',
      status: 'active',
      title: 'Наберу группу',
      personIds: [],
      projectIds: [],
      tags: [],
      probability: 0.7,
      dueAt: at(DAY, '10:00'),
    };
    const decision: ItemOfKind<'decision'> = { ...base, id: 'd1', kind: 'decision', status: 'active', title: 'Поднять цену', personIds: [], projectIds: [], tags: [], chosen: 'да', alternatives: [], reasons: [], dueAt: at(DAY, '09:00') };
    const model = buildTodayModel(
      snapshot({
        commitments: [
          commitment('theirs-late', addDays(DAY, -9), { direction: 'owed_to_me', counterpartyName: 'Борис' }),
          commitment('mine-late', addDays(DAY, -2), { counterpartyId: 'anna' }),
          commitment('today', DAY),
          commitment('future', addDays(DAY, 3)),
          commitment('nodue', undefined),
        ],
        predictions: [prediction],
        decisions: [decision],
        peopleNames: { anna: 'Анна' },
      }),
    );
    expect(model.burningCount).toBe(5);
    expect(model.burning).toHaveLength(MAX_BURNING_ROWS);
    expect(model.burning.map((row) => row.id)).toEqual(['mine-late', 'theirs-late', 'today']);
    expect(model.burning[0]).toMatchObject({ subtitle: 'Ты обещал · Анна', meta: 'просрочено на 2 дня', overdue: true });
    expect(model.burning[1]?.subtitle).toBe('Тебе должны · Борис');

    const rest = buildTodayModel(snapshot({ predictions: [prediction], decisions: [decision] }));
    expect(rest.burning.map((row) => [row.kind, row.subtitle])).toEqual([
      ['prediction', 'Прогноз · 70 %'],
      ['decision', 'Решение · как оно вышло?'],
    ]);
  });

  it('counts the people mentioned today once', () => {
    const model = buildTodayModel(snapshot({ captures: [capture('c1', '10:00', { personIds: ['a', 'b'] }), capture('c2', '11:00', { personIds: ['b', 'c'] })] }));
    expect(model.peopleCount).toBe(3);
  });
});

describe('the day key used in tests', () => {
  it('matches the local day of the fixtures', () => {
    expect(localDayKey(at(DAY, '08:00'))).toBe(DAY);
  });
});
