import { describe, expect, it } from 'vitest';
import { makeSnippet, rangesOfTerms, splitByRanges } from './highlight';
import { buildQuery, fuzzyDistance, queryTerms, termVariants } from './query';
import { termsOf, tokenize } from './tokenize';

describe('tokenize', () => {
  it('returns normalized words with offsets into the original text', () => {
    const text = 'Всё, что Ёлка сказала: «Да!»';
    const tokens = tokenize(text);
    expect(tokens.map((token) => token.term)).toEqual(['все', 'что', 'елка', 'сказала', 'да']);
    expect(tokens.map((token) => text.slice(token.start, token.end))).toEqual(['Всё', 'что', 'Ёлка', 'сказала', 'Да']);
  });

  it('splits on hyphens, keeps digits and drops stress marks inside the word', () => {
    expect(termsOf('кто-то в 2026 году')).toEqual(['кто', 'то', 'в', '2026', 'году']);
    expect(termsOf('уда́р')).toEqual(['удар']);
  });

  it('returns nothing for text without words', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize(' — ... ?!')).toEqual([]);
  });
});

describe('queryTerms', () => {
  it('normalizes and removes repeats', () => {
    expect(queryTerms('Ёлка  ёлка ЕЛКА')).toEqual(['елка']);
  });

  it('drops function words unless nothing else is left', () => {
    expect(queryTerms('что я решил про цены')).toEqual(['решил', 'цены']);
    expect(queryTerms('что я')).toEqual(['что', 'я']);
    expect(queryTerms('')).toEqual([]);
  });
});

describe('termVariants', () => {
  it('adds and strips verb prefixes, in both directions', () => {
    expect(termVariants('обещал')).toContain('пообещал');
    expect(termVariants('пообещал')).toContain('обещал');
    expect(termVariants('сделал')).toContain('делал');
    expect(termVariants('делал')).toContain('сделал');
  });

  it('never includes the word itself and leaves short words alone', () => {
    expect(termVariants('обещал')).not.toContain('обещал');
    expect(termVariants('ход')).toEqual([]);
    expect(termVariants('приход')).toContain('сприход');
    expect(termVariants('приход')).not.toContain('ход');
  });
});

describe('fuzzyDistance', () => {
  it('grows with the length of the word', () => {
    expect([1, 2, 3, 5, 6, 12].map(fuzzyDistance)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe('buildQuery', () => {
  it('combines the words and wraps a word with variants into an OR', () => {
    const query = buildQuery(['обещал', 'ход'], { combine: 'and', prefix: true, fuzzy: true });
    expect(query).toMatchObject({ combineWith: 'AND' });
    const [first, second] = (query as { queries: unknown[] }).queries;
    expect(first).toMatchObject({ combineWith: 'OR' });
    expect(second).toMatchObject({ queries: ['ход'], prefix: true, fuzzy: 1 });
  });

  it('turns prefix and typos off', () => {
    const query = buildQuery(['ход'], { combine: 'or', prefix: false, fuzzy: false });
    expect(query).toMatchObject({ combineWith: 'OR', queries: [{ queries: ['ход'], prefix: false, fuzzy: false }] });
  });
});

describe('highlighting', () => {
  it('finds the words of a text among terms', () => {
    const text = 'Маша Иванова позвонила Маше';
    expect(rangesOfTerms(text, new Set(['маша', 'иванова']))).toEqual([[0, 4], [5, 12]]);
    expect(rangesOfTerms(text, new Set(['маше']))).toEqual([[23, 27]]);
    expect(rangesOfTerms(text, new Set())).toEqual([]);
  });

  it('splits a text by ranges, with matches at the edges', () => {
    expect(splitByRanges('abcdef', [[0, 2], [4, 6]])).toEqual([
      { text: 'ab', match: true },
      { text: 'cd', match: false },
      { text: 'ef', match: true },
    ]);
    expect(splitByRanges('abc', [])).toEqual([{ text: 'abc', match: false }]);
    expect(splitByRanges('', [])).toEqual([]);
  });

  it('keeps a short text whole and flattens line breaks without moving matches', () => {
    expect(makeSnippet('первая\nвторая', [[7, 13]])).toEqual({ text: 'первая вторая', ranges: [[7, 13]] });
  });

  it('cuts a long text on word boundaries around the first match', () => {
    const text = `${'начало '.repeat(30)}нужное слово ${'конец '.repeat(30)}`;
    const start = text.indexOf('нужное');
    const snippet = makeSnippet(text, [[start, start + 6]], 60);
    expect(snippet.text.startsWith('…')).toBe(true);
    expect(snippet.text.endsWith('…')).toBe(true);
    expect(snippet.text.length).toBeLessThanOrEqual(62);
    expect(snippet.ranges.map(([from, to]) => snippet.text.slice(from, to))).toEqual(['нужное']);
    expect(snippet.text).not.toMatch(/…\S*\s?…$/u);
  });

  it('starts at the beginning when the match is near it, and drops matches that were cut away', () => {
    const text = `слово ${'и еще '.repeat(60)}слово`;
    const snippet = makeSnippet(text, [[0, 5], [text.length - 5, text.length]], 50);
    expect(snippet.text.startsWith('слово')).toBe(true);
    expect(snippet.text.endsWith('…')).toBe(true);
    expect(snippet.ranges).toEqual([[0, 5]]);
  });

  it('cuts the head of a long text that has no match', () => {
    const snippet = makeSnippet('слово '.repeat(50), [], 30);
    expect(snippet.text.endsWith('…')).toBe(true);
    expect(snippet.ranges).toEqual([]);
  });
});
