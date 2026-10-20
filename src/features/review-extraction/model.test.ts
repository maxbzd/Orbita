import { describe, expect, it } from 'vitest';
import type { Capture, Item, Person } from '../../domain/types';
import type { Job } from '../../state';
import { approximateSecond, instrumentalName, deriveReviewView, foundLog, foundTitle, groupByKind, itemFacts, memoryPhrase } from './model';
import { objectsCount } from '../../domain/counts';

const NOW = '2026-10-08T10:00:00.000Z';

function capture(overrides: Partial<Capture> = {}): Capture {
  return { id: 'c1', createdAt: NOW, updatedAt: NOW, kind: 'voice', day: '2026-10-08', text: 'Текст записи', projectIds: [], personIds: [], tags: [], status: 'review', ...overrides };
}

function item(overrides: Record<string, unknown> = {}): Item {
  return {
    id: 'i1',
    createdAt: NOW,
    updatedAt: NOW,
    kind: 'task',
    status: 'proposed',
    title: 'Позвонить маме Саши',
    personIds: [],
    projectIds: [],
    tags: [],
    captureId: 'c1',
    ...overrides,
  } as Item;
}

const job = (overrides: Partial<Job>): Job => ({ captureId: 'c1', stage: 'running', mode: 'auto', startedAt: 0, ...overrides });

const person = (id: string, name: string): Person =>
  ({ id, name, aliases: [], role: 'other', mentionCount: 1, createdAt: NOW, updatedAt: NOW }) as Person;

describe('what the review screen shows', () => {
  it('waits for the data, and knows a missing or trashed capture', () => {
    expect(deriveReviewView({ capture: undefined, items: [], job: undefined })).toEqual({ kind: 'loading' });
    expect(deriveReviewView({ capture: capture(), items: undefined, job: undefined })).toEqual({ kind: 'loading' });
    expect(deriveReviewView({ capture: null, items: [], job: undefined })).toEqual({ kind: 'missing' });
    expect(deriveReviewView({ capture: capture({ deletedAt: NOW }), items: [], job: undefined })).toEqual({ kind: 'missing' });
  });

  it('shows the processing state from the job and from the capture status', () => {
    expect(deriveReviewView({ capture: capture({ status: 'raw' }), items: [], job: job({ stage: 'saving' }) })).toEqual({ kind: 'processing', stage: 'saving', manual: false });
    expect(deriveReviewView({ capture: capture({ status: 'transcribed' }), items: [], job: job({ stage: 'running' }) })).toEqual({ kind: 'processing', stage: 'queued', manual: false });
    expect(deriveReviewView({ capture: capture({ status: 'transcribing' }), items: [], job: job({ stage: 'running' }) })).toMatchObject({ stage: 'transcribing' });
    expect(deriveReviewView({ capture: capture({ status: 'extracting' }), items: [], job: job({ stage: 'running', mode: 'manual' }) })).toEqual({ kind: 'processing', stage: 'extracting', manual: true });
  });

  it('a capture left in a busy status by another tab or a crash still shows as processing', () => {
    expect(deriveReviewView({ capture: capture({ status: 'extracting' }), items: [], job: undefined })).toMatchObject({ kind: 'processing', stage: 'extracting' });
  });

  it('a running job beats the proposals of the earlier run', () => {
    expect(deriveReviewView({ capture: capture({ status: 'extracting' }), items: [item()], job: job({ stage: 'running' }) }).kind).toBe('processing');
  });

  it('shows the failure with the message for «Повторить», from the job or from the capture', () => {
    expect(deriveReviewView({ capture: capture({ status: 'failed' }), items: [], job: job({ stage: 'failed', message: 'Нет ответа от провайдера' }) })).toEqual({ kind: 'failed', message: 'Нет ответа от провайдера' });
    expect(deriveReviewView({ capture: capture({ status: 'failed', error: 'Лимит запросов' }), items: [], job: undefined })).toEqual({ kind: 'failed', message: 'Лимит запросов' });
  });

  it('waiting keeps its reason', () => {
    const view = deriveReviewView({ capture: capture({ status: 'transcribed' }), items: [], job: job({ stage: 'waiting', waiting: 'no-key', message: 'Не задан ключ' }) });
    expect(view).toEqual({ kind: 'waiting', reason: 'no-key', message: 'Не задан ключ' });
  });

  it('a saved capture nobody processed in this session just waits', () => {
    expect(deriveReviewView({ capture: capture({ status: 'transcribed' }), items: [], job: undefined })).toMatchObject({ kind: 'waiting', reason: 'idle' });
    expect(deriveReviewView({ capture: capture({ status: 'raw', text: '' }), items: [], job: undefined })).toMatchObject({ kind: 'waiting', reason: 'idle' });
  });

  it('proposed objects are the review', () => {
    const view = deriveReviewView({ capture: capture(), items: [item({ id: 'a' }), item({ id: 'b', status: 'active' })], job: job({ stage: 'done' }) });
    expect(view).toMatchObject({ kind: 'review' });
    if (view.kind === 'review') expect(view.proposed.map((i) => i.id)).toEqual(['a']);
  });

  it('when all is decided, the accepted ones and the count of dismissed', () => {
    const view = deriveReviewView({
      capture: capture({ status: 'done' }),
      items: [item({ id: 'a', status: 'active' }), item({ id: 'b', status: 'dismissed' }), item({ id: 'c', status: 'done' })],
      job: undefined,
    });
    expect(view).toMatchObject({ kind: 'done', dismissed: 1 });
    if (view.kind === 'done') expect(view.accepted.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('a silent recording is "skipped"', () => {
    expect(deriveReviewView({ capture: capture({ status: 'skipped', text: '' }), items: [], job: undefined })).toEqual({ kind: 'skipped' });
  });
});

describe('wording', () => {
  it('counts objects in Russian', () => {
    expect([1, 2, 5, 11, 21].map(objectsCount)).toEqual(['1 объект', '2 объекта', '5 объектов', '11 объектов', '21 объект']);
    expect(foundTitle(5)).toBe('Нашёл 5 объектов');
  });

  it('groups by kind in a fixed order and logs only what was found', () => {
    const items = [item({ id: '1', kind: 'commitment' }), item({ id: '2', kind: 'decision' }), item({ id: '3', kind: 'decision' }), item({ id: '4', kind: 'fact' })];
    expect(groupByKind(items).map((g) => [g.kind, g.items.length])).toEqual([['decision', 2], ['commitment', 1], ['fact', 1]]);
    expect(foundLog(items)).toEqual(['Нашёл 2 решения', 'Нашёл 1 обязательство', 'Нашёл 1 факт']);
    expect(foundLog([])).toEqual([]);
  });

  it('says whom and when for a commitment', () => {
    const owed = item({ kind: 'commitment', direction: 'i_owe', counterpartyName: 'Фёдор', dueAt: '2026-10-12T09:00:00.000Z' });
    expect(itemFacts(owed)).toEqual(['Кому: Фёдор', 'до 12 окт.']);
    const toMe = item({ kind: 'commitment', direction: 'owed_to_me', counterpartyId: 'p1' });
    expect(itemFacts(toMe, new Map([['p1', person('p1', 'Маша')]]))).toEqual(['От кого: Маша']);
    expect(itemFacts(item({ kind: 'commitment', direction: 'i_owe' }))).toEqual(['Я должен']);
  });

  it('shows the probability and the date of a prediction, and the choice of a decision', () => {
    expect(itemFacts(item({ kind: 'prediction', probability: 0.7, dueAt: '2026-11-01T09:00:00.000Z' }))).toEqual(['70 %', 'к 1 нояб.']);
    expect(itemFacts(item({ kind: 'decision', chosen: 'Поднять цену', alternatives: [], reasons: [] }))).toEqual(['Выбор: Поднять цену']);
  });

  it('writes the memory chip like §3.5', () => {
    expect(memoryPhrase(item({ kind: 'commitment', direction: 'i_owe', counterpartyName: 'Фёдор' }))).toBe('обязательство перед Фёдором');
    expect(memoryPhrase(item({ kind: 'commitment', direction: 'owed_to_me', counterpartyName: 'Маша' }))).toBe('обязательство перед тобой: Маша');
    expect(memoryPhrase(item({ kind: 'idea', title: 'Мини-курс по KPI' }))).toBe('идея: Мини-курс по KPI');
    expect(memoryPhrase(item({ kind: 'task', title: 'x'.repeat(100) })).length).toBeLessThanOrEqual(62);
  });

  it('puts common names into the instrumental case and leaves the rest', () => {
    expect(instrumentalName('Фёдор')).toBe('Фёдором');
    expect(instrumentalName('Анна')).toBe('Анной');
    expect(instrumentalName('Мария Петровна')).toBe('Марией Петровна');
    expect(instrumentalName('Андрей')).toBe('Андреем');
    expect(instrumentalName('Дима')).toBe('Димой');
    expect(instrumentalName('Алиса Selezneva')).toBe('Алисой Selezneva');
    expect(instrumentalName('Ян')).toBe('Ян');
  });

  it('places a quote in the recording roughly', () => {
    const c = { text: 'x'.repeat(200), durationSec: 100 };
    expect(approximateSecond(c, 50)).toBe(25);
    expect(approximateSecond(c, undefined)).toBeUndefined();
    expect(approximateSecond({ text: 'abc' }, 1)).toBeUndefined();
  });
});
