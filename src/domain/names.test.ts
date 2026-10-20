import { describe, expect, it } from 'vitest';
import {
  NAME_SCORE,
  compareNames,
  damerauLevenshtein,
  maxEditDistance,
  nameKey,
  nameStem,
  namesMatch,
  normalizeName,
  rankByName,
  titleCaseName,
  uniqueAliases,
} from './names';

describe('normalizeName', () => {
  it('lower-cases, folds ё, drops punctuation and extra spaces', () => {
    expect(normalizeName('  Ёлка   Иванова. ')).toBe('елка иванова');
    expect(normalizeName('Пётр')).toBe('петр');
    expect(normalizeName('Маша!')).toBe('маша');
    expect(normalizeName("О'Коннор")).toBe('оконнор');
  });

  it('keeps inner hyphens and drops dangling ones', () => {
    expect(normalizeName('Анна-Мария')).toBe('анна-мария');
    expect(normalizeName('- Анна -')).toBe('анна');
    expect(normalizeName('')).toBe('');
  });
});

describe('titleCaseName', () => {
  it('capitalizes every word and hyphenated part', () => {
    expect(titleCaseName('иван  петров-сидоров')).toBe('Иван Петров-Сидоров');
    expect(titleCaseName('МАША')).toBe('МАША');
  });
});

describe('nameStem: cases collapse to one stem', () => {
  const groups: Record<string, string[]> = {
    Маша: ['Маша', 'Маши', 'Маше', 'Машу', 'Машей', 'Машею'],
    Иван: ['Иван', 'Ивана', 'Ивану', 'Иваном', 'Иване'],
    Алексей: ['Алексей', 'Алексея', 'Алексею', 'Алексеем', 'Алексее'],
    Борис: ['Борис', 'Бориса', 'Борису', 'Борисом', 'Борисе'],
    Дмитрий: ['Дмитрий', 'Дмитрия', 'Дмитрию', 'Дмитрием', 'Дмитрии'],
    Илья: ['Илья', 'Ильи', 'Илье', 'Илью', 'Ильёй'],
    Мария: ['Мария', 'Марии', 'Марию', 'Марией'],
    Пётр: ['Пётр', 'Петра', 'Петру', 'Петром', 'Петре'],
    Александр: ['Александр', 'Александра', 'Александру', 'Александром', 'Александре'],
    Анна: ['Анна', 'Анны', 'Анне', 'Анну', 'Анной'],
    Иванова: ['Иванова', 'Ивановой', 'Иванову', 'Ивановым'],
    Дима: ['Дима', 'Димы', 'Диме', 'Диму', 'Димой'],
    Женя: ['Женя', 'Жени', 'Жене', 'Женю', 'Женей'],
  };

  for (const [name, forms] of Object.entries(groups)) {
    it(`${name}: ${forms.join(', ')}`, () => {
      const stems = new Set(forms.map(nameStem));
      expect(stems.size).toBe(1);
    });
  }

  it('gives the expected stem for the examples from the spec', () => {
    expect(nameStem('Маши')).toBe('маш');
    expect(nameStem('Машу')).toBe('маш');
    expect(nameStem('Машей')).toBe('маш');
    expect(nameStem('Маша')).toBe('маш');
  });

  it('never strips a name down to a single letter', () => {
    expect(nameStem('Ия')).toBe('ия');
    expect(nameStem('Ким')).toBe('ким');
    expect(nameStem('Ян')).toBe('ян');
    expect(nameStem('Яна')).toBe('ян');
  });

  it('stems each part of a hyphenated name', () => {
    expect(nameStem('Салтыкова-Щедрина')).toBe(nameStem('Салтыков-Щедрин'));
  });

  it('keeps different names apart', () => {
    const stems = ['Маша', 'Миша', 'Марина', 'Мария', 'Дима', 'Дина', 'Оля', 'Коля', 'Лев', 'Лена'].map(nameStem);
    expect(new Set(stems).size).toBe(stems.length);
  });
});

describe('nameKey', () => {
  it('stems every token', () => {
    expect(nameKey('Ивану Петрову')).toBe('иван петров');
    expect(nameKey('')).toBe('');
  });
});

describe('damerauLevenshtein', () => {
  it('counts the classic operations', () => {
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3);
    expect(damerauLevenshtein('', 'abc')).toBe(3);
    expect(damerauLevenshtein('abc', '')).toBe(3);
    expect(damerauLevenshtein('same', 'same')).toBe(0);
    expect(damerauLevenshtein('маша', 'миша')).toBe(1);
  });

  it('counts an adjacent swap as one edit', () => {
    expect(damerauLevenshtein('ab', 'ba')).toBe(1);
    expect(damerauLevenshtein('кирилл', 'кирлил')).toBe(1);
    expect(damerauLevenshtein('ca', 'abc')).toBe(3); // optimal string alignment, not full Damerau
  });
});

describe('maxEditDistance', () => {
  it('forbids typos in very short names', () => {
    expect(maxEditDistance(3)).toBe(0);
    expect(maxEditDistance(4)).toBe(1);
    expect(maxEditDistance(6)).toBe(1);
    expect(maxEditDistance(7)).toBe(2);
  });
});

describe('compareNames', () => {
  it('scores identical text as exact', () => {
    expect(compareNames('Маша', 'маша')).toEqual({ score: NAME_SCORE.exact, reason: 'exact' });
    expect(compareNames('Пётр', 'Петр')).toEqual({ score: NAME_SCORE.exact, reason: 'exact' });
  });

  it('scores other case forms as stem matches', () => {
    expect(compareNames('Машу', 'Маша')).toEqual({ score: NAME_SCORE.stem, reason: 'stem' });
    expect(compareNames('Ивану Петрову', 'Иван Петров')).toEqual({ score: NAME_SCORE.stem, reason: 'stem' });
  });

  it('ignores token order', () => {
    expect(compareNames('Иванов Иван', 'Иван Иванов')?.reason).toBe('stem');
  });

  it('treats a hyphen like a space, as speech recognition writes them interchangeably', () => {
    expect(compareNames('Анна Мария', 'Анна-Мария')?.reason).toBe('stem');
    expect(compareNames('онлайн школа', 'Онлайн-школа')?.reason).toBe('stem');
    expect(compareNames('Мария', 'Анна-Мария')?.reason).toBe('partial');
  });

  it('scores a part of a name as partial', () => {
    expect(compareNames('Маша', 'Маша Иванова')).toEqual({ score: NAME_SCORE.partial, reason: 'partial' });
    expect(compareNames('Ивановой', 'Мария Иванова')?.reason).toBe('partial');
  });

  it('tolerates typos in longer names only', () => {
    expect(compareNames('Катерина', 'Катирина')).toEqual({ score: NAME_SCORE.fuzzy, reason: 'fuzzy' });
    expect(compareNames('Кирилл', 'Кирлил')?.reason).toBe('fuzzy');
    expect(compareNames('Катирина', 'Катерина Иванова')).toEqual({ score: NAME_SCORE.fuzzyPartial, reason: 'fuzzyPartial' });
    expect(compareNames('Маша', 'Миша')).toBeNull();
    expect(compareNames('Оля', 'Коля')).toBeNull();
    expect(compareNames('Дима', 'Дина')).toBeNull();
  });

  it('does not match different people', () => {
    expect(compareNames('Марина', 'Мария')).toBeNull();
    expect(compareNames('Иван Петров', 'Иван Сидоров')).toBeNull();
    expect(compareNames('Анна', 'Иван')).toBeNull();
  });

  it('returns null for empty names', () => {
    expect(compareNames('', 'Маша')).toBeNull();
    expect(compareNames('Маша', '  ')).toBeNull();
    expect(compareNames('...', 'Маша')).toBeNull();
  });
});

describe('namesMatch', () => {
  it('requires at least a stem match by default', () => {
    expect(namesMatch('Машей', 'Маша')).toBe(true);
    expect(namesMatch('Маша', 'Маша Иванова')).toBe(false);
    expect(namesMatch('Маша', 'Маша Иванова', NAME_SCORE.partial)).toBe(true);
    expect(namesMatch('Катерина', 'Катирина')).toBe(false);
  });
});

describe('rankByName', () => {
  const people = [
    { id: 1, name: 'Мария Иванова' },
    { id: 2, name: 'Маша Петрова' },
    { id: 3, name: 'Маша' },
    { id: 4, name: 'Александр Волков', aliases: ['Саша', 'Шура'] },
  ];

  it('ranks exact case forms above partial name hits and drops non-matches', () => {
    const ranked = rankByName('Машу', people);
    expect(ranked.map((match) => match.entity.id)).toEqual([3, 2]);
    expect(ranked[0]).toMatchObject({ score: NAME_SCORE.stem, reason: 'stem' });
    expect(ranked[1]).toMatchObject({ score: NAME_SCORE.partial, reason: 'partial' });
  });

  it('matches through aliases', () => {
    expect(rankByName('Саша', people)[0]).toMatchObject({ entity: { id: 4 }, score: NAME_SCORE.alias, reason: 'alias' });
    expect(rankByName('Сашей', people)[0]).toMatchObject({ entity: { id: 4 }, score: NAME_SCORE.stem });
  });

  it('prefers the exact name over an alias hit', () => {
    const list = [
      { id: 1, name: 'Саша Орлов' },
      { id: 2, name: 'Александр Волков', aliases: ['Саша Орлов'] },
    ];
    expect(rankByName('Саша Орлов', list).map((match) => match.entity.id)).toEqual([1, 2]);
  });

  it('applies the minimum score', () => {
    expect(rankByName('Маша', people, { minScore: NAME_SCORE.stem }).map((match) => match.entity.id)).toEqual([3]);
    expect(rankByName('Никто', people)).toEqual([]);
  });
});

describe('uniqueAliases', () => {
  it('drops duplicates by normalized form and the canonical name itself', () => {
    expect(uniqueAliases('Мария', ['Маша', 'маша', ' Мария ', 'Маруся'], ['МАРУСЯ', 'Муся', ''])).toEqual([
      'Маша',
      'Маруся',
      'Муся',
    ]);
  });
});
