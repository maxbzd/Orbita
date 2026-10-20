import { describe, expect, it } from 'vitest';
import { filterCommands, normalizeQuery } from './commandFilter';
import type { CommandItem } from './commandFilter';

const item = (id: string, title: string, extra: Partial<CommandItem> = {}): CommandItem => ({ id, title, run: () => undefined, ...extra });

const items: CommandItem[] = [
  item('record', 'Новая запись', { keywords: ['голос', 'мысль'] }),
  item('today', 'Сегодня'),
  item('people', 'Люди', { subtitle: 'Фёдор, Анна' }),
  item('settings', 'Настройки', { keywords: ['тема', 'ключ'] }),
  item('yo', 'Ёлка на праздник'),
];

describe('normalizeQuery', () => {
  it('lower-cases, trims and folds ё into е', () => {
    expect(normalizeQuery('  ЁЛКА  ')).toBe('елка');
  });
});

describe('filterCommands', () => {
  it('returns everything, in order, for an empty query', () => {
    expect(filterCommands(items, '').map((i) => i.id)).toEqual(['record', 'today', 'people', 'settings', 'yo']);
    expect(filterCommands(items, '   ')).toHaveLength(5);
  });

  it('matches case-insensitively and across ё/е', () => {
    expect(filterCommands(items, 'ЕЛКА').map((i) => i.id)).toEqual(['yo']);
    expect(filterCommands(items, 'сегодня').map((i) => i.id)).toEqual(['today']);
  });

  it('matches keywords and subtitles, not only titles', () => {
    expect(filterCommands(items, 'голос').map((i) => i.id)).toEqual(['record']);
    expect(filterCommands(items, 'анна').map((i) => i.id)).toEqual(['people']);
  });

  it('requires every word of the query to match somewhere', () => {
    expect(filterCommands(items, 'новая запись').map((i) => i.id)).toEqual(['record']);
    expect(filterCommands(items, 'новая тема').map((i) => i.id)).toEqual([]);
    expect(filterCommands(items, 'настройки тема').map((i) => i.id)).toEqual(['settings']);
  });

  it('ranks a title prefix above a word prefix above a substring above keywords', () => {
    const ranked = filterCommands(
      [
        item('keyword', 'Другое', { keywords: ['запись'] }),
        item('substring', 'Перезапись файла'),
        item('word', 'Новая запись'),
        item('prefix', 'Запись голосом'),
      ],
      'запись',
    );
    expect(ranked.map((i) => i.id)).toEqual(['prefix', 'word', 'substring', 'keyword']);
  });

  it('keeps the given order among equal matches and never mutates the input', () => {
    const input = [item('a', 'Альфа'), item('b', 'Альбом'), item('c', 'Алмаз')];
    const copy = [...input];
    expect(filterCommands(input, 'ал').map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(input).toEqual(copy);
  });

  it('finds nothing for a word that is nowhere', () => {
    expect(filterCommands(items, 'zzz')).toEqual([]);
  });
});
