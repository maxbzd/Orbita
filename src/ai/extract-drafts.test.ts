import { describe, expect, it } from 'vitest';
import { localDayKey, localMinutesOfDay } from '../domain/dates';
import { MIN_ITEM_CONFIDENCE, dueAtFromDay, normalizeProbability, normalizeTags, normalizeUnit, toItemDraft } from './extract-drafts';
import type { DraftContext } from './extract-drafts';
import type { ExtractedItem } from './prompts/schemas';

const TEXT = 'Сегодня решил поднять цену на тестовое. Обещал Маше прислать план до пятницы.';

const context = (overrides: Partial<DraftContext> = {}): DraftContext => ({
  text: TEXT,
  captureDay: '2026-10-07',
  personId: (name) => (name === 'Маша' ? 'person-masha' : undefined),
  projectId: (name) => (name === 'Маяк' ? 'project-everest' : undefined),
  openItemByRef: new Map([['o1', { id: 'open-1', kind: 'commitment' as const }]]),
  ...overrides,
});

const base = { body: null, quote: null, confidence: 0.9, people: [], projects: [], dueDate: null, duplicateOf: null, tags: [] };
const commitment = (overrides: Partial<Extract<ExtractedItem, { kind: 'commitment' }>> = {}): ExtractedItem => ({
  kind: 'commitment',
  ...base,
  title: 'Прислать план Маше',
  direction: 'i_owe',
  counterparty: 'Маша',
  ...overrides,
});

describe('numbers', () => {
  it('reads percentages and junk as a unit value', () => {
    expect(normalizeUnit(0.7, 0.5)).toBe(0.7);
    expect(normalizeUnit(85, 0.5)).toBe(0.85);
    expect(normalizeUnit(-3, 0.5)).toBe(0);
    expect(normalizeUnit(1000, 0.5)).toBe(1);
    expect(normalizeUnit(Number.NaN, 0.5)).toBe(0.5);
    expect(normalizeUnit(null, 0.4)).toBe(0.4);
  });

  it('keeps probabilities inside [0.01, 0.99]', () => {
    expect(normalizeProbability(70)).toBe(0.7);
    expect(normalizeProbability(0)).toBe(0.01);
    expect(normalizeProbability(1)).toBe(0.99);
    expect(normalizeProbability(100)).toBe(0.99);
    expect(normalizeProbability(Number.NaN)).toBe(0.5);
  });
});

describe('dueAtFromDay', () => {
  it('is the last minute of the local day', () => {
    const due = dueAtFromDay('2026-10-09', '2026-10-07');
    expect(due).toBeDefined();
    expect(localDayKey(due ?? '')).toBe('2026-10-09');
    expect(localMinutesOfDay(due ?? '')).toBe(23 * 60 + 59);
  });

  it('drops dates before the record, malformed ones and those absurdly far away', () => {
    expect(dueAtFromDay('2026-10-06', '2026-10-07')).toBeUndefined();
    expect(dueAtFromDay('2026-02-30', '2026-01-01')).toBeUndefined();
    expect(dueAtFromDay('в пятницу', '2026-10-07')).toBeUndefined();
    expect(dueAtFromDay('2099-01-01', '2026-10-07')).toBeUndefined();
    expect(dueAtFromDay(null, '2026-10-07')).toBeUndefined();
    expect(dueAtFromDay('2026-10-07', '2026-10-07')).toBeDefined();
  });
});

describe('toItemDraft', () => {
  it('keeps a verified quote with its offset and the full confidence', () => {
    const draft = toItemDraft(
      { kind: 'decision', ...base, title: 'Поднять цену', quote: 'поднять цену на тестовое', question: null, chosen: 'Поднять цену на тестовое', alternatives: [], reasons: [], expected: null },
      context(),
    );
    expect(draft).toMatchObject({ kind: 'decision', quote: 'поднять цену на тестовое', quoteStart: TEXT.indexOf('поднять'), confidence: 0.9 });
  });

  it('distrusts a quote the record does not contain: no quote stored, confidence lowered', () => {
    const draft = toItemDraft(commitment({ quote: 'Я клянусь прислать всё завтра' }), context());
    expect(draft?.quote).toBeUndefined();
    expect(draft?.quoteStart).toBeUndefined();
    expect(draft?.confidence).toBeCloseTo(0.72);
  });

  it('does not penalize a missing quote', () => {
    expect(toItemDraft(commitment({ quote: null }), context())?.confidence).toBe(0.9);
  });

  it('drops objects with no title or hopeless confidence', () => {
    expect(toItemDraft(commitment({ title: '   ' }), context())).toBeUndefined();
    expect(toItemDraft(commitment({ confidence: MIN_ITEM_CONFIDENCE - 0.01 }), context())).toBeUndefined();
    expect(toItemDraft(commitment({ confidence: 0.35, quote: 'выдуманная цитата' }), context())).toBeUndefined();
  });

  it('cuts long titles to the limit of the contract and collapses whitespace', () => {
    const draft = toItemDraft(commitment({ title: `  ${'очень '.repeat(60)}\n длинно ` }), context());
    expect(draft?.title).toHaveLength(120);
    expect(draft?.title).not.toContain('\n');
  });

  it('links a commitment to a known person, or keeps the name', () => {
    const known = toItemDraft(commitment({ people: ['Маша'] }), context());
    expect(known).toMatchObject({ kind: 'commitment', counterpartyId: 'person-masha', personIds: ['person-masha'], direction: 'i_owe' });
    expect(known && 'counterpartyName' in known).toBe(false);

    const unknown = toItemDraft(commitment({ counterparty: 'Иван' }), context());
    expect(unknown).toMatchObject({ counterpartyName: 'Иван', personIds: [] });
    expect(unknown && 'counterpartyId' in unknown).toBe(false);
  });

  it('turns percent probabilities into fractions and resolves dates', () => {
    const draft = toItemDraft({ kind: 'prediction', ...base, title: 'Подпишут договор', probability: 70, dueDate: '2026-10-31' }, context());
    expect(draft).toMatchObject({ kind: 'prediction', probability: 0.7 });
    expect(draft?.dueAt).toBeDefined();
  });

  it('ignores deadlines for kinds where they mean nothing', () => {
    const draft = toItemDraft({ kind: 'idea', ...base, title: 'Мини-курс', stage: 'spark', dueDate: '2026-10-31' }, context());
    expect(draft).toMatchObject({ kind: 'idea', stage: 'spark', relatedIds: [] });
    expect(draft && 'dueAt' in draft).toBe(false);
  });

  it('honors duplicateOf only for an object of the same kind', () => {
    expect(toItemDraft(commitment({ duplicateOf: 'O1' }), context())?.duplicateOf).toBe('open-1');
    expect(toItemDraft({ kind: 'task', ...base, title: 'Прислать план', priority: null, duplicateOf: 'o1' }, context())?.duplicateOf).toBeUndefined();
    expect(toItemDraft(commitment({ duplicateOf: 'o99' }), context())?.duplicateOf).toBeUndefined();
  });

  it('resolves projects, normalizes tags and leaves no undefined placeholders', () => {
    const draft = toItemDraft({ kind: 'lesson', ...base, title: 'Не назначать тестовые вечером', projects: ['Маяк', 'Неизвестный'], tags: ['#Тестовые', 'тестовые', ' '] }, context());
    expect(draft).toMatchObject({ projectIds: ['project-everest'], tags: ['тестовые'] });
    expect((Object.values(draft ?? {}) as unknown[]).includes(undefined)).toBe(false);
  });

  it('falls back to the title when a decision names no choice', () => {
    const draft = toItemDraft({ kind: 'decision', ...base, title: 'Остаёмся на Zoom', question: null, chosen: '  ', alternatives: [' Meet ', ''], reasons: [], expected: null }, context());
    expect(draft).toMatchObject({ chosen: 'Остаёмся на Zoom', alternatives: ['Meet'] });
  });
});

describe('normalizeTags', () => {
  it('lower-cases, strips #, removes repeats and long junk, and limits the count', () => {
    expect(normalizeTags(['#А', 'а', 'Б', 'в', 'г', 'д', 'x'.repeat(40)])).toEqual(['а', 'б', 'в', 'г']);
    expect(normalizeTags(['1', '2', '3'], 2)).toEqual(['1', '2']);
  });
});
