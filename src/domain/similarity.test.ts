import { describe, expect, it } from 'vitest';
import { findSimilar, trigramSimilarity, trigrams } from './similarity';

describe('trigrams', () => {
  it('pads each word like pg_trgm', () => {
    expect([...trigrams('кот')].sort()).toEqual(['  к', ' ко', 'кот', 'от '].sort());
  });

  it('is empty for text without words', () => {
    expect(trigrams('').size).toBe(0);
    expect(trigrams(' ... !!! ').size).toBe(0);
  });
});

describe('trigramSimilarity', () => {
  it('is 1 for the same text up to case, ё and punctuation', () => {
    expect(trigramSimilarity('Позвонить маме завтра', 'позвонить МАМЕ, завтра!')).toBe(1);
    expect(trigramSimilarity('Всё готово', 'все готово')).toBe(1);
  });

  it('is high for a lightly reworded sentence', () => {
    expect(trigramSimilarity('Позвонить маме завтра утром', 'Позвонить маме завтра')).toBeGreaterThan(0.6);
    expect(trigramSimilarity('Сделать лендинг для курса', 'Сделать лендинг курса')).toBeGreaterThan(0.6);
  });

  it('is low for unrelated sentences', () => {
    expect(trigramSimilarity('Позвонить маме завтра', 'Запустить рекламу в телеграме')).toBeLessThan(0.15);
  });

  it('is 0 when either side has no words', () => {
    expect(trigramSimilarity('', 'что-то')).toBe(0);
    expect(trigramSimilarity('что-то', '')).toBe(0);
    expect(trigramSimilarity('', '')).toBe(0);
  });

  it('is symmetric', () => {
    const a = 'Купить микрофон для записи';
    const b = 'Микрофон для записи голоса';
    expect(trigramSimilarity(a, b)).toBe(trigramSimilarity(b, a));
  });
});

describe('findSimilar', () => {
  const items = [
    { id: 'a', title: 'Запустить рекламу в телеграме' },
    { id: 'b', title: 'Позвонить маме завтра утром' },
    { id: 'c', title: 'Позвонить маме' },
    { id: 'd', title: '' },
  ];

  it('returns items above the threshold, best first', () => {
    const found = findSimilar('Позвонить маме завтра', items, (item) => item.title, 0.4);
    expect(found.map((match) => match.item.id)).toEqual(['b', 'c']);
    expect(found[0]!.score).toBeGreaterThan(found[1]!.score);
  });

  it('returns nothing for a text without words or when nothing is close', () => {
    expect(findSimilar('...', items, (item) => item.title)).toEqual([]);
    expect(findSimilar('Совсем другое', items, (item) => item.title)).toEqual([]);
  });
});
