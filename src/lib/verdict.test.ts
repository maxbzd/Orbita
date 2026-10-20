import { describe, expect, it } from 'vitest';
import { EMPTY_DAY_COUNTS, dateVerdict, daySummary, dayVerdict, greetingForHour, greetingLine, isEveningHour } from './verdict';

const DAY = '2026-10-07';

describe('dayVerdict', () => {
  it('is "Тихий день" with no records', () => {
    expect(dayVerdict(EMPTY_DAY_COUNTS, DAY)).toBe('Тихий день');
  });

  it('falls back to the date when nothing stands out', () => {
    expect(dayVerdict({ ...EMPTY_DAY_COUNTS, captures: 2 }, DAY)).toBe('Среда, 7 октября');
    expect(dateVerdict('2026-10-08')).toBe('Четверг, 8 октября');
  });

  it('puts overdue promises before everything else', () => {
    expect(dayVerdict({ captures: 9, decisions: 4, ideas: 7, overdue: 1 }, DAY)).toBe('Есть долги по обещаниям');
    expect(dayVerdict({ ...EMPTY_DAY_COUNTS, overdue: 2 }, DAY)).toBe('Есть долги по обещаниям');
  });

  it('calls three or more decisions a day of decisions', () => {
    expect(dayVerdict({ captures: 3, decisions: 3, ideas: 0, overdue: 0 }, DAY)).toBe('День решений');
    expect(dayVerdict({ captures: 3, decisions: 2, ideas: 0, overdue: 0 }, DAY)).toBe('Среда, 7 октября');
  });

  it('calls five or more ideas "Много идей", after decisions', () => {
    expect(dayVerdict({ captures: 5, decisions: 0, ideas: 5, overdue: 0 }, DAY)).toBe('Много идей');
    expect(dayVerdict({ captures: 5, decisions: 0, ideas: 4, overdue: 0 }, DAY)).toBe('Среда, 7 октября');
    expect(dayVerdict({ captures: 8, decisions: 3, ideas: 5, overdue: 0 }, DAY)).toBe('День решений');
  });
});

describe('greetings', () => {
  it.each([
    [0, 'Доброй ночи'],
    [4, 'Доброй ночи'],
    [5, 'Доброе утро'],
    [10, 'Доброе утро'],
    [11, 'Добрый день'],
    [16, 'Добрый день'],
    [17, 'Добрый вечер'],
    [22, 'Добрый вечер'],
    [23, 'Доброй ночи'],
  ])('at %i o\'clock says "%s"', (hour, text) => {
    expect(greetingForHour(hour)).toBe(text);
  });

  it('adds the name from the profile, and only when there is one', () => {
    expect(greetingLine(19, ' Фёдор ')).toBe('Добрый вечер, Фёдор');
    expect(greetingLine(19, '   ')).toBe('Добрый вечер');
    expect(greetingLine(8, null)).toBe('Доброе утро');
  });

  it('treats 18:00 to midnight as the evening', () => {
    expect(isEveningHour(17)).toBe(false);
    expect(isEveningHour(18)).toBe(true);
    expect(isEveningHour(23)).toBe(true);
    expect(isEveningHour(2)).toBe(false);
  });
});

describe('daySummary', () => {
  it('agrees numbers with nouns and the verb', () => {
    expect(daySummary({ captures: 2, burning: 1 })).toBe('2 записи. 1 дело горит.');
    expect(daySummary({ captures: 1, burning: 2 })).toBe('1 запись. 2 дела горят.');
    expect(daySummary({ captures: 5, burning: 5 })).toBe('5 записей. 5 дел горят.');
    expect(daySummary({ captures: 21, burning: 11 })).toBe('21 запись. 11 дел горят.');
  });

  it('is honest when nothing was recorded or nothing burns', () => {
    expect(daySummary({ captures: 0, burning: 0 })).toBe('Записей пока нет. Ничего не горит.');
    expect(daySummary({ captures: 3, burning: 0 })).toBe('3 записи. Ничего не горит.');
  });
});
