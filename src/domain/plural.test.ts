import { describe, expect, it } from 'vitest';
import { countRu, pluralRu } from './plural';

const FORMS = ['запись', 'записи', 'записей'] as const;

describe('pluralRu', () => {
  it('picks the form by the last digits', () => {
    const expected: [number, string][] = [
      [0, 'записей'],
      [1, 'запись'],
      [2, 'записи'],
      [4, 'записи'],
      [5, 'записей'],
      [11, 'записей'],
      [12, 'записей'],
      [14, 'записей'],
      [21, 'запись'],
      [22, 'записи'],
      [25, 'записей'],
      [101, 'запись'],
      [111, 'записей'],
      [112, 'записей'],
      [1000, 'записей'],
    ];
    for (const [count, form] of expected) expect(pluralRu(count, FORMS), String(count)).toBe(form);
  });

  it('treats negatives and fractions by their whole part', () => {
    expect(pluralRu(-2, FORMS)).toBe('записи');
    expect(pluralRu(2.7, FORMS)).toBe('записи');
  });
});

describe('countRu', () => {
  it('prefixes the number', () => {
    expect(countRu(3, FORMS)).toBe('3 записи');
  });
});
