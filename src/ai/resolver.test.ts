import { describe, expect, it } from 'vitest';
import { NAME_SCORE } from '../domain/names';
import { DUPLICATE_THRESHOLD, dedupeDrafts, findDuplicate, findMergeCandidates, findRestatement, isFullerName, resolveByName } from './resolver';

const person = (id: string, name: string, aliases: string[] = []) => ({ id, name, aliases });

describe('resolveByName', () => {
  const people = [person('1', 'Маша Иванова', ['Мария']), person('2', 'Пётр Сидоров'), person('3', 'Алексей')];

  it('links an exact name, another case form and an alias', () => {
    expect(resolveByName('Алексей', people)).toMatchObject({ status: 'matched', entity: { id: '3' }, reason: 'exact', score: 1 });
    expect(resolveByName('Алексея', people)).toMatchObject({ status: 'matched', entity: { id: '3' }, reason: 'stem' });
    expect(resolveByName('Пете Сидорову', people)).toMatchObject({ status: 'new' });
    expect(resolveByName('Мария', people)).toMatchObject({ status: 'matched', entity: { id: '1' }, reason: 'alias' });
  });

  it('links a first name to the one person who has it', () => {
    expect(resolveByName('Маше', people)).toMatchObject({ status: 'matched', entity: { id: '1' }, reason: 'partial' });
  });

  it('does not guess between two equally good people', () => {
    const twins = [person('a', 'Маша Иванова'), person('b', 'Маша Петрова')];
    const result = resolveByName('Маша', twins);
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') expect(result.candidates.map((candidate) => candidate.entity.id).sort()).toEqual(['a', 'b']);
  });

  it('prefers an exact match over a partial one', () => {
    const result = resolveByName('Маша', [person('a', 'Маша Иванова'), person('b', 'Маша')]);
    expect(result).toMatchObject({ status: 'matched', entity: { id: 'b' } });
  });

  it('keeps people with different surnames apart', () => {
    expect(resolveByName('Маша Петрова', [person('a', 'Маша Иванова')])).toMatchObject({ status: 'new', similar: [] });
  });

  it('treats a typo as a new person but offers the look-alike as a merge hint', () => {
    const result = resolveByName('Екатерена', [person('3', 'Екатерина')]);
    expect(result.status).toBe('new');
    if (result.status === 'new') expect(result.similar[0]).toMatchObject({ entity: { id: '3' }, reason: 'fuzzy' });
  });

  it('finds nothing for an empty list or an unrelated name', () => {
    expect(resolveByName('Иван', [])).toEqual({ status: 'new', similar: [] });
    expect(resolveByName('Иван', people)).toEqual({ status: 'new', similar: [] });
  });

  it('works for projects through keywords as aliases', () => {
    const projects = [{ id: 'p', name: 'Маяк', aliases: ['школа математики'] }];
    expect(resolveByName('Маяк', projects).status).toBe('matched');
    expect(resolveByName('школа математики', projects)).toMatchObject({ status: 'matched', reason: 'alias' });
  });
});

describe('findMergeCandidates', () => {
  it('lists look-alike pairs once, best first', () => {
    const people = [person('1', 'Маша'), person('2', 'Маша Иванова'), person('3', 'Екатерина'), person('4', 'Екатерена'), person('5', 'Иван')];
    const hints = findMergeCandidates(people);
    expect(hints.map((hint) => [hint.a.id, hint.b.id, hint.reason])).toEqual([
      ['1', '2', 'partial'],
      ['3', '4', 'fuzzy'],
    ]);
    expect(hints.map((hint) => hint.score)).toEqual([NAME_SCORE.partial, NAME_SCORE.fuzzy]);
  });

  it('notices a name that is another one\'s alias and respects the minimum score', () => {
    const people = [person('1', 'Мария Петровна', ['Мария']), person('2', 'Мария')];
    expect(findMergeCandidates(people)).toHaveLength(1);
    expect(findMergeCandidates([person('1', 'Екатерина'), person('2', 'Екатерена')], NAME_SCORE.stem)).toEqual([]);
  });
});

describe('isFullerName', () => {
  it('is true when the mention adds a part to the known name', () => {
    expect(isFullerName('Маша Иванова', 'Маша')).toBe(true);
    expect(isFullerName('Маша', 'Маша Иванова')).toBe(false);
    expect(isFullerName('Маша Петрова', 'Маша Иванова')).toBe(false);
  });
});

describe('duplicate objects', () => {
  const open = [
    { id: 'c1', kind: 'commitment' as const, title: 'Отправить КП Ивану' },
    { id: 't1', kind: 'task' as const, title: 'Отправить КП Ивану' },
    { id: 'i1', kind: 'idea' as const, title: 'Мини-курс по KPI для родителей' },
  ];

  it('finds a restated object of the same kind only', () => {
    const duplicate = findDuplicate({ kind: 'commitment', title: 'Отправить КП Ивану до пятницы' }, open);
    expect(duplicate?.item.id).toBe('c1');
    expect(duplicate?.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
    expect(findDuplicate({ kind: 'decision', title: 'Отправить КП Ивану' }, open)).toBeUndefined();
    expect(findDuplicate({ kind: 'idea', title: 'Купить новый микрофон' }, open)).toBeUndefined();
  });

  it('drops restatements inside one extraction, keeping the more confident one', () => {
    const drafts = [
      { kind: 'task' as const, title: 'Позвонить Маше завтра', confidence: 0.6 },
      { kind: 'idea' as const, title: 'Позвонить Маше завтра', confidence: 0.9 },
      { kind: 'task' as const, title: 'Позвонить Маше завтра утром', confidence: 0.9 },
      { kind: 'task' as const, title: 'Составить расписание на неделю', confidence: 0.7 },
    ];
    expect(dedupeDrafts(drafts).map((draft) => [draft.kind, draft.title])).toEqual([
      ['task', 'Позвонить Маше завтра утром'],
      ['idea', 'Позвонить Маше завтра'],
      ['task', 'Составить расписание на неделю'],
    ]);
  });

  describe('findRestatement', () => {
    const settled = [
      { id: 'd1', kind: 'decision' as const, title: 'Пробные только по вторникам', quote: 'Решил проводить тестовые только по вторникам.' },
      { id: 't2', kind: 'task' as const, title: 'Позвонить Пете', quote: 'Надо позвонить Пете и написать Маше.' },
    ];

    it('recognizes a near-identical title', () => {
      expect(findRestatement({ kind: 'decision', title: 'Пробные только по вторникам!' }, settled)?.id).toBe('d1');
    });

    it('recognizes an edited title through the same evidence quote', () => {
      const draft = {
        kind: 'decision' as const,
        title: 'Решил проводить тестовые только по вторникам, потому что в пятницу все уставшие',
        quote: 'решил проводить тестовые только  по вторникам.',
      };
      expect(findDuplicate(draft, settled)).toBeUndefined();
      expect(findRestatement(draft, settled)?.id).toBe('d1');
    });

    it('keeps two objects of one sentence apart', () => {
      const second = { kind: 'task' as const, title: 'Написать Маше', quote: 'Надо позвонить Пете и написать Маше.' };
      expect(findRestatement(second, settled)).toBeUndefined();
    });

    it('does not mix kinds or quotes', () => {
      const lesson = { kind: 'lesson' as const, title: 'Пробные только по вторникам', quote: 'Решил проводить тестовые только по вторникам.' };
      expect(findRestatement(lesson, settled)).toBeUndefined();
      expect(findRestatement({ kind: 'decision', title: 'Пробные по вторникам', quote: 'Совсем другая цитата' }, [{ ...settled[0], title: 'Другое решение про цены' }])).toBeUndefined();
    });
  });
});
