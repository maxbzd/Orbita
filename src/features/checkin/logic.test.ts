import { describe, expect, it } from 'vitest';
import { setLocale } from '../../i18n';
import { ENERGY_VALUES, HIDE_FROM_AI_TAG, draftToCheckIn, energyLevelOf, isHiddenFromAi, moodFactors, wordsForMood } from './logic';

describe('wordsForMood', () => {
  it('shows five to seven words at once for every step', () => {
    for (const step of [-3, -2, -1, 0, 1, 2, 3]) {
      const { featured } = wordsForMood(step);
      expect(featured.length).toBeGreaterThanOrEqual(5);
      expect(featured.length).toBeLessThanOrEqual(7);
    }
  });

  it('leads with words of the mood and keeps the rest behind "Ещё" without repeats', () => {
    const heavy = wordsForMood(-2);
    expect(heavy.featured).toContain('тревожно');
    expect(heavy.featured).not.toContain('радостно');
    expect(heavy.more).toContain('радостно');
    expect(heavy.more.filter((word) => heavy.featured.includes(word))).toEqual([]);
    expect(new Set(heavy.more).size).toBe(heavy.more.length);
    expect(wordsForMood(2).featured).toContain('радостно');
  });
});

describe('draftToCheckIn', () => {
  const draft = { step: 2, energy: 'high' as const, words: ['Тревожно', 'устал'], factors: ['Деньги', 'тревожно'], note: '  тяжёлый созвон  ', hideFromAi: false };

  it('maps the step to valence −1…+1 and the energy level to a number, origin manual', () => {
    const input = draftToCheckIn(draft);
    expect(input.valence).toBeCloseTo(2 / 3);
    expect(input.energy).toBe(ENERGY_VALUES.high);
    expect(input.origin).toBe('manual');
    expect(draftToCheckIn({ ...draft, step: -3 }).valence).toBe(-1);
    expect(draftToCheckIn({ ...draft, step: 0 }).valence).toBe(0);
  });

  it('stores words and factors as lower-case tags without repeats, and trims the note', () => {
    const input = draftToCheckIn(draft);
    expect(input.tags).toEqual(['тревожно', 'устал', 'деньги']);
    expect(input.note).toBe('тяжёлый созвон');
    expect(draftToCheckIn({ ...draft, note: '   ' })).not.toHaveProperty('note');
  });

  it('marks a state hidden from the AI with the reserved tag', () => {
    const input = draftToCheckIn({ ...draft, hideFromAi: true });
    expect(input.tags).toContain(HIDE_FROM_AI_TAG);
    expect(isHiddenFromAi({ tags: input.tags ?? [] })).toBe(true);
    expect(isHiddenFromAi({ tags: ['деньги'] })).toBe(false);
  });
});

describe('energy and factors', () => {
  it('finds the level of a stored energy', () => {
    expect(energyLevelOf(0.1)).toBe('low');
    expect(energyLevelOf(0.5)).toBe('mid');
    expect(energyLevelOf(0.9)).toBe('high');
  });

  it('offers the seven factors of the spec', () => {
    expect(moodFactors()).toEqual(['Деньги', 'Клиенты', 'Команда', 'Контент', 'Учёба', 'Сон', 'Люди']);
  });

  it('speaks English when the locale is English', () => {
    setLocale('en');
    try {
      expect(moodFactors()).toEqual(['Money', 'Clients', 'Team', 'Content', 'Study', 'Sleep', 'People']);
      expect(wordsForMood(-3).featured).toContain('anxious');
    } finally {
      setLocale('ru');
    }
  });
});
