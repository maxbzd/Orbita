import { describe, expect, it } from 'vitest';
import { localDayKey } from '../../domain/dates';
import { draftFromItem, draftToNewItem, draftToPatch, emptyDraft, validateDraft } from './draft';

describe('форма объекта', () => {
  it('просит суть и проверяет длину и вероятность', () => {
    expect(validateDraft(emptyDraft('task'))).toMatch(/суть/);
    expect(validateDraft(emptyDraft('task', { title: 'я'.repeat(121) }))).toMatch(/120/);
    expect(validateDraft(emptyDraft('prediction', { title: 'Будет 20 учеников', probability: 100 }))).toMatch(/99/);
    expect(validateDraft(emptyDraft('prediction', { title: 'Будет 20 учеников', probability: 70 }))).toBeNull();
  });

  it('обязательство: контрагент из списка берёт имя из карточки, срок становится датой', () => {
    const draft = emptyDraft('commitment', { title: 'Прислать договор', direction: 'owed_to_me', counterpartyId: 'p1', dueDay: '2026-10-20' });
    const item = draftToNewItem(draft, new Map([['p1', 'Фёдор']]));
    expect(item).toMatchObject({ kind: 'commitment', direction: 'owed_to_me', counterpartyId: 'p1', counterpartyName: 'Фёдор' });
    expect(localDayKey((item as { dueAt: string }).dueAt)).toBe('2026-10-20');
  });

  it('решение: пустое «выбрано» берёт суть, альтернативы — по строкам; прогноз — доли', () => {
    const decision = draftToNewItem(emptyDraft('decision', { title: 'Взять второго консультанта', alternatives: 'Нет\n\n  Позже ' }));
    expect(decision).toMatchObject({ chosen: 'Взять второго консультанта', alternatives: ['Нет', 'Позже'] });
    expect(draftToNewItem(emptyDraft('prediction', { title: 'x', probability: 65 }))).toMatchObject({ probability: 0.65 });
  });

  it('правка: из объекта в форму и обратно без потерь, очищенный срок убирается', () => {
    const item = {
      id: 'i1',
      kind: 'task' as const,
      status: 'active' as const,
      title: 'Позвонить',
      body: 'утром',
      priority: 'high' as const,
      personIds: [],
      projectIds: [],
      tags: [],
      dueAt: new Date(2026, 9, 12).toISOString(),
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };
    const draft = draftFromItem(item);
    expect(draft).toMatchObject({ title: 'Позвонить', body: 'утром', priority: 'high', dueDay: '2026-10-12' });
    expect(draftToPatch({ ...draft, dueDay: '' })).toMatchObject({ title: 'Позвонить', priority: 'high', dueAt: undefined });
  });
});
