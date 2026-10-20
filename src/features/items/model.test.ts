import { describe, expect, it } from 'vitest';
import { startOfDayInstant } from '../../domain/dates';
import type { DayKey, Item, ItemOfKind } from '../../domain/types';
import {
  filterDirection,
  filterItems,
  groupCommitments,
  groupCommitmentsByPerson,
  groupDecisions,
  groupFacts,
  groupIdeas,
  groupItems,
  groupPredictions,
  predictionReport,
  reviewWindow,
  dueInfo,
  dueText,
  stageChange,
  summarizeCalibration,
} from './model';

const TODAY: DayKey = '2026-10-08';
const due = (day: DayKey): string => startOfDayInstant(day).toISOString();

let seq = 0;
function base(overrides: Partial<Item> & { kind: Item['kind'] }) {
  seq += 1;
  return {
    id: `i${seq}`,
    status: 'active' as const,
    title: `Объект ${seq}`,
    personIds: [],
    projectIds: [],
    tags: [],
    createdAt: `2026-09-${String(10 + (seq % 15)).padStart(2, '0')}T10:00:00.000Z`,
    updatedAt: '2026-09-30T10:00:00.000Z',
    ...overrides,
  };
}

const commitment = (over: Partial<ItemOfKind<'commitment'>> = {}): ItemOfKind<'commitment'> =>
  ({ ...base({ kind: 'commitment' }), kind: 'commitment', direction: 'i_owe', ...over }) as ItemOfKind<'commitment'>;
const prediction = (over: Partial<ItemOfKind<'prediction'>> = {}): ItemOfKind<'prediction'> =>
  ({ ...base({ kind: 'prediction' }), kind: 'prediction', probability: 0.7, ...over }) as ItemOfKind<'prediction'>;
const decision = (over: Partial<ItemOfKind<'decision'>> = {}): ItemOfKind<'decision'> =>
  ({ ...base({ kind: 'decision' }), kind: 'decision', chosen: 'Да', alternatives: [], reasons: [], ...over }) as ItemOfKind<'decision'>;
const idea = (over: Partial<ItemOfKind<'idea'>> = {}): ItemOfKind<'idea'> =>
  ({ ...base({ kind: 'idea' }), kind: 'idea', stage: 'spark', relatedIds: [], ...over }) as ItemOfKind<'idea'>;

const ids = (items: readonly Item[]): string[] => items.map((item) => item.id);

describe('обязательства: группы и просрочка', () => {
  const late = commitment({ id: 'late', dueAt: due('2026-10-05') });
  const soon = commitment({ id: 'soon', dueAt: due('2026-10-12') });
  const edge = commitment({ id: 'edge', dueAt: due('2026-10-15') });
  const far = commitment({ id: 'far', dueAt: due('2026-10-16') });
  const noDue = commitment({ id: 'none' });
  const done = commitment({ id: 'done', status: 'done', doneAt: '2026-10-01T10:00:00.000Z' });

  it('делит на «Скоро» (с просроченными), «Активные» и «Закрытые»', () => {
    const groups = groupCommitments([noDue, far, done, edge, soon, late], { today: TODAY });
    expect(groups.map((g) => g.title)).toEqual(['Скоро', 'Активные', 'Закрытые']);
    expect(ids(groups[0]!.items)).toEqual(['late', 'soon', 'edge']);
    expect(ids(groups[1]!.items)).toEqual(['far', 'none']);
    expect(ids(groups[2]!.items)).toEqual(['done']);
  });

  it('просрочку подписывает текстом, а закрытое не считает просроченным', () => {
    expect(dueText(late, TODAY)).toBe('просрочено на 3 дня');
    expect(dueInfo(late, TODAY)?.overdue).toBe(true);
    expect(dueText(commitment({ dueAt: due(TODAY) }), TODAY)).toBe('срок сегодня');
    expect(dueText(soon, TODAY)).toBe('срок через 4 дня');
    expect(dueText(commitment({ status: 'done', dueAt: due('2026-10-01') }), TODAY)).toBeUndefined();
  });

  it('пустые группы не показывает', () => {
    expect(groupCommitments([noDue], { today: TODAY }).map((g) => g.title)).toEqual(['Активные']);
  });

  it('переключатель направления оставляет только нужное', () => {
    const mine = commitment({ id: 'mine', direction: 'i_owe' });
    const theirs = commitment({ id: 'theirs', direction: 'owed_to_me' });
    expect(ids(filterDirection([mine, theirs], 'owed_to_me'))).toEqual(['theirs']);
    expect(ids(filterDirection([mine, theirs], 'all'))).toEqual(['mine', 'theirs']);
  });

  it('по людям: у кого просрочка — выше, имя берёт из карточки человека или из имени-заглушки', () => {
    const people = new Map([['p1', { name: 'Фёдор' }]]);
    const groups = groupCommitmentsByPerson(
      [
        commitment({ id: 'a1', counterpartyId: 'p1', dueAt: due('2026-10-20') }),
        commitment({ id: 'b1', counterpartyName: 'Мария', dueAt: due('2026-10-01') }),
        commitment({ id: 'a2', counterpartyId: 'p1' }),
        commitment({ id: 'c1', status: 'done' }),
      ],
      people,
      { today: TODAY },
    );
    expect(groups.map((g) => g.title)).toEqual(['Мария', 'Фёдор', 'Закрытые']);
    expect(ids(groups[1]!.items)).toEqual(['a1', 'a2']);
  });
});

describe('решения: окно пересмотра', () => {
  it('кольцо идёт от создания к дате пересмотра и подписано днями', () => {
    const item = decision({ createdAt: '2026-10-01T00:00:00.000Z', dueAt: '2026-10-21T00:00:00.000Z' });
    const win = reviewWindow(item, '2026-10-08T00:00:00.000Z', TODAY);
    expect(win?.progress).toBeCloseTo(0.35, 2);
    expect(win?.label).toBe('до пересмотра 13 дней');
    expect(win?.due).toBe(false);
  });

  it('после даты — «пора», без даты и после итога окна нет', () => {
    const late = decision({ createdAt: '2026-09-01T00:00:00.000Z', dueAt: due('2026-10-06') });
    expect(reviewWindow(late, '2026-10-08T12:00:00.000Z', TODAY)).toMatchObject({ progress: 1, due: true, label: 'пересмотр просрочен на 2 дня' });
    expect(reviewWindow(decision(), '2026-10-08T00:00:00.000Z', TODAY)).toBeUndefined();
    expect(reviewWindow(decision({ dueAt: due('2026-10-20'), outcome: { rating: 4, note: '', at: '2026-10-07T00:00:00.000Z' } }), '2026-10-08T00:00:00.000Z', TODAY)).toBeUndefined();
  });

  it('журнал: «Пора пересмотреть», «Журнал», «Пересмотрено»', () => {
    const groups = groupDecisions(
      [
        decision({ id: 'due', dueAt: due('2026-10-07') }),
        decision({ id: 'wait', dueAt: due('2026-11-01') }),
        decision({ id: 'closed', status: 'done', outcome: { rating: 5, note: 'ok', at: '2026-10-02T00:00:00.000Z' } }),
      ],
      { today: TODAY },
    );
    expect(groups.map((g) => [g.title, ids(g.items)])).toEqual([
      ['Пора пересмотреть', ['due']],
      ['Журнал', ['wait']],
      ['Пересмотрено', ['closed']],
    ]);
  });
});

describe('прогнозы: «к закрытию» и калибровка', () => {
  it('«К закрытию» — открытые с наступившей датой', () => {
    const groups = groupPredictions(
      [prediction({ id: 'due', dueAt: due('2026-10-08') }), prediction({ id: 'later', dueAt: due('2026-12-01') }), prediction({ id: 'shut', status: 'done', outcome: 'true' })],
      { today: TODAY },
    );
    expect(groups.map((g) => g.title)).toEqual(['К закрытию', 'Открытые', 'Закрытые']);
  });

  it('меньше пяти закрытых — «мало данных», «неизвестно» не считается', () => {
    const closed = [prediction({ outcome: 'true' }), prediction({ outcome: 'false' }), prediction({ outcome: 'unknown' }), prediction({ outcome: 'true' }), prediction({ outcome: 'true' })];
    const summary = summarizeCalibration(predictionReport(closed));
    expect(summary.enough).toBe(false);
    expect(summary.headline).toBe('Мало данных');
    expect(summary.lines[0]).toContain('Закрыто 4 из 5');
  });

  it('от пяти закрытых — счёт Брайера и перекос в словах', () => {
    const closed = [
      prediction({ probability: 0.9, outcome: 'true' }),
      prediction({ probability: 0.9, outcome: 'false' }),
      prediction({ probability: 0.8, outcome: 'false' }),
      prediction({ probability: 0.7, outcome: 'true' }),
      prediction({ probability: 0.9, outcome: 'false' }),
    ];
    const report = predictionReport(closed);
    expect(report.enough).toBe(true);
    const summary = summarizeCalibration(report);
    expect(summary.enough).toBe(true);
    // mean((.9-1)^2, (.9-0)^2, (.8-0)^2, (.7-1)^2, (.9-0)^2) = (0.01+0.81+0.64+0.09+0.81)/5 = 0.472
    expect(summary.brier).toBe('0,47');
    expect(summary.lines.join(' ')).toContain('переоценивать «да» на 44 п. п.');
  });
});

describe('идеи, факты, поиск', () => {
  it('идеи сгруппированы по стадиям в порядке искра → отброшена', () => {
    const groups = groupIdeas([
      idea({ id: 'p', stage: 'parked' }),
      idea({ id: 's', stage: 'spark' }),
      idea({ id: 'x', stage: 'dropped', status: 'dropped' }),
      idea({ id: 'd', stage: 'doing' }),
      idea({ id: 'fin', stage: 'doing', status: 'done' }),
    ]);
    expect(groups.map((g) => g.title)).toEqual(['Искры', 'В работе', 'Отложены', 'Сделаны', 'Отброшены']);
  });

  it('стадия «отброшена» закрывает идею, любая другая — возвращает в открытые', () => {
    expect(stageChange('dropped', 'active')).toEqual({ stage: 'dropped', status: 'dropped' });
    expect(stageChange('exploring', 'dropped')).toEqual({ stage: 'exploring', status: 'active' });
    expect(stageChange('doing', 'proposed')).toEqual({ stage: 'doing', status: 'proposed' });
  });

  it('факты: актуальные и устаревшие', () => {
    const groups = groupFacts([
      { ...base({ kind: 'fact' }), kind: 'fact', id: 'new', value: '16' } as Item,
      { ...base({ kind: 'fact' }), kind: 'fact', id: 'old', value: '14', supersededBy: 'new', status: 'dropped' } as Item,
    ]);
    expect(groups.map((g) => [g.title, ids(g.items)])).toEqual([
      ['Актуальные', ['new']],
      ['Устарели', ['old']],
    ]);
  });

  it('ждущие подтверждения идут отдельной группой, отклонённых нет нигде', () => {
    const items = [commitment({ id: 'p', status: 'proposed' }), commitment({ id: 'a' }), commitment({ id: 'x', status: 'dismissed' })];
    expect(filterItems(items, { text: '', status: 'all' }).map((i) => i.id)).toEqual(['a']);
    expect(filterItems(items, { text: '', status: 'proposed' }).map((i) => i.id)).toEqual(['p']);
    expect(groupItems('commitment', filterItems(items, { text: '', status: 'proposed' }), { today: TODAY }).map((g) => g.title)).toEqual(['Ждут подтверждения']);
  });

  it('поиск: все слова, без регистра и ё; фильтры по человеку и проекту', () => {
    const items = [
      commitment({ id: '1', title: 'Прислать договор Фёдору', counterpartyId: 'p1' }),
      commitment({ id: '2', title: 'Оплатить хостинг', projectIds: ['pr1'] }),
      idea({ id: '3', title: 'Интенсив к OKR', body: 'Запуск в ноябре' }),
    ];
    expect(ids(filterItems(items, { text: 'федору договор', status: 'all' }))).toEqual(['1']);
    expect(ids(filterItems(items, { text: 'федору хостинг', status: 'all' }))).toEqual([]);
    expect(ids(filterItems(items, { text: 'фёдору ДОГОВОР', status: 'all' }))).toEqual(['1']);
    expect(ids(filterItems(items, { text: 'ноябре', status: 'all' }))).toEqual(['3']);
    expect(ids(filterItems(items, { text: '', status: 'all', personId: 'p1' }))).toEqual(['1']);
    expect(ids(filterItems(items, { text: '', status: 'all', projectId: 'pr1' }))).toEqual(['2']);
  });
});
