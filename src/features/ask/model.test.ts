import { describe, expect, it } from 'vitest';
import { NoKeyError, RateLimitError, parseCitations, segmentAnswer } from '../../ai';
import type { AskAnswer, AskSource } from '../../ai';
import { askErrorText, citationPath, historyOf, questionFromSearch, stripCodes } from './model';
import type { Turn } from './model';

const sources: AskSource[] = [
  { code: 'c1', kind: 'capture', id: 'cap-1', label: 'Запись 5 окт.' },
  { code: 'i2', kind: 'item', id: 'item-2', label: 'Позвонить Маше' },
  { code: 'p3', kind: 'person', id: 'per-3', label: 'Маша' },
];

describe('citations in an answer', () => {
  it('turns verified codes into link segments and drops invented ones', () => {
    const cited = parseCitations('Вы обещали позвонить [c1][i2] и ещё что-то [c9].', sources);
    expect(cited.unknownCodes).toEqual(['c9']);
    const segments = segmentAnswer(cited.text, cited.citations);
    expect(segments.filter((s) => s.type === 'ref').map((s) => (s.type === 'ref' ? s.citation.code : ''))).toEqual(['c1', 'i2']);
    expect(segments.map((s) => (s.type === 'text' ? s.text : `{${s.citation.code}}`)).join('')).toBe('Вы обещали позвонить {c1}{i2} и ещё что-то .'.replace(' .', '.'));
  });

  it('keeps markup as plain text segments: nothing is parsed as HTML', () => {
    const cited = parseCitations('<img src=x onerror=alert(1)> **жирный** [c1]', sources);
    const text = segmentAnswer(cited.text, cited.citations).find((s) => s.type === 'text');
    expect(text).toMatchObject({ type: 'text', text: expect.stringContaining('<img src=x onerror=alert(1)>') });
  });
});

describe('stripCodes (while streaming)', () => {
  it('hides complete and half-typed codes', () => {
    expect(stripCodes('Вы обещали [c1][i2] позвонить [c1, i2].')).toBe('Вы обещали позвонить.');
    expect(stripCodes('Вы обещали позвонить [c')).toBe('Вы обещали позвонить ');
    expect(stripCodes('Вы обещали позвонить [c1')).toBe('Вы обещали позвонить ');
    expect(stripCodes('Массив [1, 2, 3] остаётся')).toBe('Массив [1, 2, 3] остаётся');
  });
});

describe('history for the model', () => {
  const answered = (n: number): Turn => ({
    id: n,
    question: `вопрос ${n}`,
    status: 'done',
    partial: '',
    answer: { question: `вопрос ${n}`, text: `ответ ${n}`, citations: [], unknownCodes: [], materials: { text: '', sources: [] }, usage: { provider: 'x', model: 'y', inputTokens: 1, outputTokens: 1 } } satisfies AskAnswer,
  });
  it('sends only finished turns, in order', () => {
    const turns: Turn[] = [answered(1), { id: 2, question: 'сорвался', status: 'error', partial: '', error: 'x' }, answered(3), { id: 4, question: 'идёт', status: 'thinking', partial: 'ча' }];
    expect(historyOf(turns)).toEqual([
      { role: 'user', content: 'вопрос 1' },
      { role: 'assistant', content: 'ответ 1' },
      { role: 'user', content: 'вопрос 3' },
      { role: 'assistant', content: 'ответ 3' },
    ]);
  });
});

describe('where a link leads', () => {
  it('captures, people and patterns directly; objects through their capture', () => {
    expect(citationPath({ kind: 'capture', id: 'c' })).toBe('/entry/c');
    expect(citationPath({ kind: 'person', id: 'p' })).toBe('/people/p');
    expect(citationPath({ kind: 'pattern', id: 't' })).toBe('/patterns');
    expect(citationPath({ kind: 'item', id: 'i' }, { kind: 'task', captureId: 'c' })).toBe('/entry/c?item=i');
    expect(citationPath({ kind: 'item', id: 'i' }, { kind: 'task', captureId: undefined })).toBe('/items/task');
  });
});

describe('errors and the ?q= link', () => {
  it('speaks Russian', () => {
    expect(askErrorText(new NoKeyError())).toMatch(/ключ/);
    expect(askErrorText(new RateLimitError())).toMatch(/[а-я]/i);
    expect(askErrorText(new Error('boom'))).toBe('Не удалось получить ответ: boom');
    expect(askErrorText('???')).toMatch(/Не удалось получить ответ/);
  });
  it('reads and limits the question of a link', () => {
    expect(questionFromSearch('?q=Что%20я%20обещал%3F')).toBe('Что я обещал?');
    expect(questionFromSearch('?q=%20%20')).toBeNull();
    expect(questionFromSearch('')).toBeNull();
    expect(questionFromSearch(`?q=${'а'.repeat(900)}`)).toHaveLength(500);
  });
});
