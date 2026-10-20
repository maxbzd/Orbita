import { describe, expect, it } from 'vitest';
import { documentTitleFor } from './documentTitle';

describe('documentTitleFor', () => {
  it('names the screen before the app', () => {
    expect(documentTitleFor('/today')).toBe('Сегодня · Орбита');
    expect(documentTitleFor('/items/prediction')).toBe('Коллекции · Орбита');
    expect(documentTitleFor('/review/abc')).toBe('Разбор записи · Орбита');
  });
  it('falls back to the app name', () => {
    expect(documentTitleFor('/')).toBe('Орбита');
    expect(documentTitleFor('/nope')).toBe('Орбита');
  });
});
