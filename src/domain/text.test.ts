import { describe, expect, it } from 'vitest';
import { countWords, normalizeForSearch, truncate, words } from './text';

describe('normalizeForSearch', () => {
  it('lower-cases and folds ё', () => {
    expect(normalizeForSearch('Ёж ПРИВЕТ')).toBe('еж привет');
    expect(normalizeForSearch('Всё')).toBe('все');
  });

  it('removes stress marks and collapses whitespace', () => {
    expect(normalizeForSearch('моло́ко')).toBe('молоко');
    expect(normalizeForSearch('  a \n\t b  ')).toBe('a b');
  });

  it('applies compatibility normalization', () => {
    expect(normalizeForSearch('ＡＢＣ ①')).toBe('abc 1');
  });
});

describe('words', () => {
  it('splits on anything but letters and digits, keeping inner hyphens and apostrophes', () => {
    expect(words('Привет, мир! Это 2-й тест: don\'t, кто-то.')).toEqual(['Привет', 'мир', 'Это', '2-й', 'тест', "don't", 'кто-то']);
  });

  it('returns an empty list for text without words', () => {
    expect(words('')).toEqual([]);
    expect(words('— … !')).toEqual([]);
  });
});

describe('countWords', () => {
  it('counts words', () => {
    expect(countWords('Один два  три\nчетыре')).toBe(4);
    expect(countWords('')).toBe(0);
  });
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('коротко', 10)).toBe('коротко');
    expect(truncate('ровно', 5)).toBe('ровно');
  });

  it('cuts to the limit including the ellipsis', () => {
    expect(truncate('очень длинный заголовок', 10)).toBe('очень дли…');
    expect(Array.from(truncate('очень длинный заголовок', 10))).toHaveLength(10);
  });

  it('does not split a surrogate pair', () => {
    expect(truncate('😀😀😀😀', 3)).toBe('😀😀…');
  });

  it('does not leave a space before the ellipsis', () => {
    expect(truncate('слово слово', 7)).toBe('слово…');
  });
});
