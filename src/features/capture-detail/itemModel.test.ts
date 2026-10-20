import { describe, expect, it } from 'vitest';
import type { Item } from '../../domain/types';
import { itemActions, itemMeta } from './itemModel';

const base = { id: '1', status: 'active', title: 'T', createdAt: '2026-10-07T10:00:00.000Z', updatedAt: '2026-10-07T10:00:00.000Z', personIds: [], projectIds: [], tags: [] };

describe('quick actions of an object', () => {
  it('decides on a proposal, closes an open object, brings a closed one back', () => {
    expect(itemActions('proposed').map((a) => a.action)).toEqual(['accept', 'dismiss']);
    expect(itemActions('active').map((a) => a.action)).toEqual(['done', 'drop']);
    for (const status of ['done', 'dropped', 'dismissed'] as const) expect(itemActions(status).map((a) => a.action)).toEqual(['reopen']);
    expect(itemActions('proposed')[0]?.primary).toBe(true);
  });
});

describe('itemMeta', () => {
  it('says who owes whom, how sure the forecast is, and the deadline', () => {
    const commitment = { ...base, kind: 'commitment', direction: 'i_owe', counterpartyName: 'Маша', dueAt: '2026-10-12T09:00:00.000Z' } as unknown as Item;
    expect(itemMeta(commitment)).toBe('Я должен: Маша · срок 12 окт.');
    expect(itemMeta({ ...commitment, direction: 'owed_to_me', counterpartyName: undefined, dueAt: undefined } as unknown as Item)).toBe('Мне должны');
    expect(itemMeta({ ...base, kind: 'prediction', probability: 0.7 } as unknown as Item)).toBe('Вероятность 70 %');
  });

  it('has nothing to add for a plain task', () => {
    expect(itemMeta({ ...base, kind: 'task' } as unknown as Item)).toBeUndefined();
  });
});
