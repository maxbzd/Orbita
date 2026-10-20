import { describe, expect, it } from 'vitest';
import { MAX_PARTS, PART_CHARS, mergeExtractions, splitText } from './parts';
import type { Extraction } from './prompts/schemas';

const extraction = (overrides: Partial<Extraction> = {}): Extraction => ({
  title: 'Заголовок',
  summary: 'Итог.',
  tags: [],
  mood: null,
  items: [],
  people: [],
  projects: [],
  questionsForUser: [],
  ...overrides,
});

describe('splitText', () => {
  it('keeps a short text whole', () => {
    expect(splitText('Короткая запись.')).toEqual({ parts: ['Короткая запись.'], truncated: false });
  });

  it('cuts a long text at paragraph, then sentence boundaries, and loses nothing', () => {
    const paragraph = `${'Это предложение про тестовые занятия. '.repeat(20)}`.trim();
    const text = Array.from({ length: 8 }, () => paragraph).join('\n\n');
    const { parts, truncated } = splitText(text, 1_000);
    expect(truncated).toBe(false);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= 1_000)).toBe(true);
    // Every part is a plain substring of the record, so quotes can be located in the whole text.
    expect(parts.every((part) => text.includes(part))).toBe(true);
    expect(parts.join('').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''));
    // A part ends where a sentence ends.
    expect(parts.slice(0, -1).every((part) => /[.!?]$/.test(part))).toBe(true);
  });

  it('falls back to a word, then to a hard cut for text without any break', () => {
    const words = splitText('слово '.repeat(100), 100);
    expect(words.parts.every((part) => /слово$/.test(part))).toBe(true);
    const solid = splitText('я'.repeat(250), 100);
    expect(solid.parts.map((part) => part.length)).toEqual([100, 100, 50]);
  });

  it('reports a tail it did not process', () => {
    const text = 'Слово. '.repeat(500);
    const { parts, truncated } = splitText(text, 100, 3);
    expect(parts).toHaveLength(3);
    expect(truncated).toBe(true);
  });

  it('has limits that keep one record affordable', () => {
    expect(PART_CHARS * MAX_PARTS).toBeLessThanOrEqual(150_000);
  });
});

describe('mergeExtractions', () => {
  it('returns a single extraction as it is', () => {
    const only = extraction();
    expect(mergeExtractions([only])).toBe(only);
  });

  it('joins items and summaries, keeps the first title and the most confident mood', () => {
    const mood = (confidence: number, valence: number) => ({ valence, energy: 0.5, focus: null, stress: null, tags: [], note: null, confidence, quote: null });
    const merged = mergeExtractions([
      extraction({ title: 'Первая часть', summary: 'Раз.', tags: ['цены'], mood: mood(0.4, -0.5), questionsForUser: ['Когда?'] }),
      extraction({ title: 'Вторая часть', summary: 'Два.', tags: ['цены', 'реклама'], mood: mood(0.9, 0.6), questionsForUser: ['Когда?', 'Кому?'] }),
    ]);
    expect(merged.title).toBe('Первая часть');
    expect(merged.summary).toBe('Раз. Два.');
    expect(merged.tags).toEqual(['цены', 'реклама']);
    expect(merged.mood?.valence).toBe(0.6);
    expect(merged.questionsForUser).toEqual(['Когда?', 'Кому?']);
  });

  it('merges one person and one project mentioned in several parts', () => {
    const person = (aliases: string[], role: 'other' | 'parent', sentiment: number | null) => ({ name: 'Маша', aliases, role, sentiment, note: null });
    const merged = mergeExtractions([
      extraction({ people: [person(['Машенька'], 'other', null)], projects: [{ name: 'Маяк', kind: 'business', keywords: ['курс'] }] }),
      extraction({ people: [person(['Мария'], 'parent', 0.5)], projects: [{ name: 'маяк', kind: 'business', keywords: ['запуск'] }] }),
    ]);
    expect(merged.people).toEqual([{ name: 'Маша', aliases: ['Машенька', 'Мария'], role: 'parent', sentiment: 0.5, note: null }]);
    expect(merged.projects).toEqual([{ name: 'Маяк', kind: 'business', keywords: ['курс', 'запуск'] }]);
  });
});
