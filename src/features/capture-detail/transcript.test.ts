import { describe, expect, it } from 'vitest';
import type { Item } from '../../domain/types';
import { buildMarkers, locateQuote, locateQuotes, offsetToSeconds, phraseAt, secondsToOffset, segmentTranscript, splitSentences } from './transcript';

const TEXT = 'Решил запустить интенсив в ноябре. Маше пообещал прислать программу до пятницы! Цена пока открыта.';

function item(id: string, patch: Partial<Item>): Item {
  return {
    id,
    kind: 'decision',
    status: 'active',
    title: `Объект ${id}`,
    createdAt: '2026-10-07T10:00:00.000Z',
    updatedAt: '2026-10-07T10:00:00.000Z',
    personIds: [],
    projectIds: [],
    tags: [],
    ...patch,
  } as Item;
}

describe('locateQuote', () => {
  it('trusts the stored offset while the text still matches there', () => {
    const quote = 'запустить интенсив в ноябре';
    const start = TEXT.indexOf(quote);
    expect(locateQuote(TEXT, quote, start)).toEqual({ start, end: start + quote.length });
    // An offset that points elsewhere is corrected to where the quote really is.
    expect(locateQuote(TEXT, quote, start + 1)).toEqual({ start, end: start + quote.length });
  });

  it('finds the nearest occurrence when the offset is stale', () => {
    const text = 'да. нет. да. нет';
    expect(locateQuote(text, 'да', 100)).toEqual({ start: 9, end: 11 });
    expect(locateQuote(text, 'да', 0)).toEqual({ start: 0, end: 2 });
    expect(locateQuote(text, 'да')).toEqual({ start: 0, end: 2 });
  });

  it('falls back to a looser match: case and whitespace runs do not matter', () => {
    expect(locateQuote('Решил\nзапустить   Интенсив.', 'запустить интенсив')).toEqual({ start: 6, end: 26 });
  });

  it('says the quote is not there when it is not (edited away, empty, no text)', () => {
    expect(locateQuote(TEXT, 'совсем другая фраза', 5)).toBeNull();
    expect(locateQuote(TEXT, '   ', 0)).toBeNull();
    expect(locateQuote(TEXT, undefined, 0)).toBeNull();
    expect(locateQuote('', 'что-то', 0)).toBeNull();
  });

  it('does not treat regex characters in a quote as syntax', () => {
    expect(locateQuote('Цена (около 5 000 р.) — не финал', 'около  5 000 р.)')).toEqual({ start: 6, end: 21 });
    expect(locateQuote('a+b', '(', 0)).toBeNull();
  });
});

describe('locateQuotes', () => {
  it('returns found quotes in text order and drops the rest', () => {
    const items = [
      item('late', { quote: 'Цена пока открыта', quoteStart: 80 }),
      item('lost', { quote: 'этого нет в тексте', quoteStart: 3 }),
      item('plain', {}),
      item('early', { quote: 'Решил запустить', quoteStart: 0 }),
    ];
    const found = locateQuotes(TEXT, items);
    expect(found.map((q) => q.itemId)).toEqual(['early', 'late']);
    expect(TEXT.slice(found[1]!.start, found[1]!.end)).toBe('Цена пока открыта');
  });
});

describe('marker position', () => {
  it('maps text offset to seconds by share of the text', () => {
    expect(offsetToSeconds(50, 200, 60)).toBe(15);
    expect(offsetToSeconds(0, 200, 60)).toBe(0);
    expect(offsetToSeconds(200, 200, 60)).toBe(60);
    expect(offsetToSeconds(500, 200, 60)).toBe(60);
    expect(offsetToSeconds(-5, 200, 60)).toBe(0);
  });

  it('is zero without text or length, and inverts', () => {
    expect(offsetToSeconds(10, 0, 60)).toBe(0);
    expect(offsetToSeconds(10, 100, 0)).toBe(0);
    expect(secondsToOffset(15, 200, 60)).toBe(50);
    expect(secondsToOffset(15, 200, 0)).toBe(0);
  });

  it('puts a marker at the start of its quote and skips objects whose quote is gone', () => {
    const start = TEXT.indexOf('Маше пообещал');
    const markers = buildMarkers(
      TEXT,
      [item('a', { kind: 'commitment', quote: 'Маше пообещал', quoteStart: start }), item('b', { quote: 'пропавшая цитата' })],
      TEXT.length, // one character per second keeps the arithmetic obvious
    );
    expect(markers).toEqual([{ id: 'a', time: start, kind: 'commitment', label: 'Объект a' }]);
  });
});

describe('splitSentences', () => {
  it('splits at . ! ? … and keeps the pieces covering the text', () => {
    const spans = splitSentences(TEXT);
    expect(spans.map((s) => TEXT.slice(s.start, s.end).trim())).toEqual([
      'Решил запустить интенсив в ноябре.',
      'Маше пообещал прислать программу до пятницы!',
      'Цена пока открыта.',
    ]);
    expect(spans[0]!.start).toBe(0);
    expect(spans.at(-1)!.end).toBe(TEXT.length);
    spans.slice(1).forEach((s, i) => expect(s.start).toBe(spans[i]!.end));
  });

  it('does not break numbers, and breaks lines', () => {
    const text = 'Цена 14.5 тысяч. Ещё мысль\nНовая строка';
    expect(splitSentences(text).map((s) => text.slice(s.start, s.end).trim())).toEqual(['Цена 14.5 тысяч.', 'Ещё мысль', 'Новая строка']);
  });

  it('handles empty, blank and unpunctuated text', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('  \n ')).toEqual([]);
    expect(splitSentences('просто слова')).toEqual([{ start: 0, end: 12 }]);
    expect(splitSentences('\n\nТекст.')).toEqual([{ start: 0, end: 8 }]);
  });
});

describe('phraseAt', () => {
  const phrases = splitSentences(TEXT);

  it('follows the share of the text played so far', () => {
    expect(phraseAt(phrases, TEXT.length, 100, 0)).toBe(0);
    expect(phraseAt(phrases, TEXT.length, 100, 50)).toBe(1);
    expect(phraseAt(phrases, TEXT.length, 100, 99)).toBe(2);
    expect(phraseAt(phrases, TEXT.length, 100, 500)).toBe(2);
  });

  it('is -1 when it cannot tell', () => {
    expect(phraseAt([], 10, 10, 1)).toBe(-1);
    expect(phraseAt(phrases, TEXT.length, 0, 1)).toBe(-1);
  });
});

describe('segmentTranscript', () => {
  it('covers the whole text with pieces that are plain, quoted, or current', () => {
    const quotes = locateQuotes(TEXT, [item('a', { quote: 'интенсив в ноябре', quoteStart: TEXT.indexOf('интенсив') })]);
    const current = splitSentences(TEXT)[0]!;
    const segments = segmentTranscript(TEXT, quotes, current);
    expect(segments.map((s) => s.text).join('')).toBe(TEXT);
    const quoted = segments.filter((s) => s.itemIds.length > 0);
    expect(quoted.map((s) => s.text).join('')).toBe('интенсив в ноябре');
    expect(quoted.every((s) => s.current)).toBe(true);
    expect(quoted[0]!.quoteStartOf).toEqual(['a']);
    expect(segments.at(-1)!.current).toBe(false);
  });

  it('splits overlapping quotes into pieces that know which quotes cover them', () => {
    const text = 'aaa bbb ccc';
    const segments = segmentTranscript(text, [
      { itemId: 'x', start: 0, end: 7 },
      { itemId: 'y', start: 4, end: 11 },
    ]);
    expect(segments.map((s) => [s.text, s.itemIds])).toEqual([
      ['aaa ', ['x']],
      ['bbb', ['x', 'y']],
      [' ccc', ['y']],
    ]);
  });

  it('is plain text when nothing is found, and nothing for empty text', () => {
    expect(segmentTranscript('просто текст', [], null)).toEqual([{ start: 0, end: 12, text: 'просто текст', itemIds: [], current: false, quoteStartOf: [] }]);
    expect(segmentTranscript('', [], null)).toEqual([]);
  });
});
