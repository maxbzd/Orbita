import { describe, expect, it } from 'vitest';
import type { Item } from '../domain/types';
import { entryOf } from './documents';
import { SearchIndex } from './engine';
import type { SearchHit } from './engine';
import { splitByRanges } from './highlight';
import { makeCapture, makePerson, makeProject, makeItem } from './test-records';

const NOW = '2026-10-07T12:00:00.000Z';

function indexOf(...records: (ReturnType<typeof makeCapture> | Item | ReturnType<typeof makePerson> | ReturnType<typeof makeProject>)[]): SearchIndex {
  const index = new SearchIndex();
  for (const record of records) {
    const entry =
      'text' in record
        ? entryOf('captures', record)
        : 'role' in record
          ? entryOf('people', record)
          : 'keywords' in record
            ? entryOf('projects', record)
            : entryOf('items', record as Item);
    if (entry) index.update([entry]);
  }
  return index;
}

const ids = (hits: readonly SearchHit[]): string[] => hits.map((hit) => hit.id);
const marked = (hit: SearchHit, field: string): string[] => {
  const highlight = hit.highlights.find((candidate) => candidate.field === field);
  return highlight ? highlight.ranges.map(([start, end]) => highlight.text.slice(start, end)) : [];
};

describe('Russian matching', () => {
  const corpus = indexOf(
    makeCapture({ id: 'promise', text: 'Вчера пообещал Маша позвонить родителям до пятницы.' }),
    makeCapture({ id: 'consult', text: 'Консультация с родителями прошла хорошо' }),
    makeCapture({ id: 'tree', text: 'Ёлка стоит во дворе, всё готово' }),
    makeCapture({ id: 'unrelated', text: 'Купил хлеб и молоко' }),
  );

  it('finds «пообещал Маша» by «обещал Маше»: a verb prefix and a case ending differ', () => {
    expect(ids(corpus.search('обещал Маше', { now: NOW }))).toEqual(['promise']);
  });

  it('works the other way round: «пообещал» finds «обещал»', () => {
    const index = indexOf(makeCapture({ id: 'a', text: 'Я обещал Маше позвонить' }));
    expect(ids(index.search('пообещал Маше'))).toEqual(['a']);
  });

  it('finds forms of a verb with a perfective prefix: «сделал» ↔ «делал»', () => {
    const index = indexOf(makeCapture({ id: 'a', text: 'Целый день делал презентацию' }), makeCapture({ id: 'b', text: 'Сегодня сделал отчёт' }));
    expect(ids(index.search('делал', { now: NOW })).sort()).toEqual(['a', 'b']);
    expect(ids(index.search('сделал', { now: NOW })).sort()).toEqual(['a', 'b']);
  });

  it('matches the beginning of a word, so a query can be typed in part', () => {
    expect(ids(corpus.search('консульт'))).toEqual(['consult']);
    expect(ids(corpus.search('родител', { combine: 'or' })).sort()).toEqual(['consult', 'promise']);
  });

  it('can switch prefix matching off', () => {
    expect(corpus.search('консульт', { prefix: false, fuzzy: false })).toEqual([]);
    expect(ids(corpus.search('консультация', { prefix: false, fuzzy: false }))).toEqual(['consult']);
  });

  it('tolerates a typo in a longer word', () => {
    expect(ids(corpus.search('консултация'))).toEqual(['consult']);
    expect(corpus.search('консултация', { fuzzy: false })).toEqual([]);
  });

  it('does not guess typos in words of one or two letters', () => {
    const index = indexOf(makeCapture({ id: 'a', text: 'им нужно время' }));
    expect(index.search('ям')).toEqual([]);
  });

  it('treats ё and е as the same letter, in the text and in the query', () => {
    expect(ids(corpus.search('елка'))).toEqual(['tree']);
    expect(ids(corpus.search('Ёлка'))).toEqual(['tree']);
    expect(ids(corpus.search('все готово'))).toEqual(['tree']);
  });

  it('ignores case and punctuation in the query', () => {
    expect(ids(corpus.search('  КОНСУЛЬТАЦИЯ!!! '))).toEqual(['consult']);
  });

  it('finds short names in another case: «Оле» → «Оля»', () => {
    const index = indexOf(makeCapture({ id: 'a', text: 'Позвонить Оля насчёт урока' }));
    expect(ids(index.search('оле'))).toEqual(['a']);
  });

  it('returns nothing for an empty query or no match', () => {
    expect(corpus.search('')).toEqual([]);
    expect(corpus.search('  ?! ')).toEqual([]);
    expect(corpus.search('квантовая хромодинамика')).toEqual([]);
  });
});

describe('several words', () => {
  const index = indexOf(
    makeCapture({ id: 'both', text: 'Решил поднять цены на курсы' }),
    makeCapture({ id: 'prices', text: 'Цены конкурентов выше' }),
    makeCapture({ id: 'courses', text: 'Новые курсы по математике' }),
  );

  it('requires every word by default and any word with combine: or', () => {
    expect(ids(index.search('цены курсы'))).toEqual(['both']);
    expect(ids(index.search('цены курсы', { combine: 'or' }))[0]).toBe('both');
    expect(ids(index.search('цены курсы', { combine: 'or' })).sort()).toEqual(['both', 'courses', 'prices']);
  });

  it('drops function words from a longer query, but keeps a query made of nothing else', () => {
    expect(ids(index.search('что я решил про цены'))).toEqual(['both']);
    const stop = indexOf(makeCapture({ id: 'a', text: 'Это он' }));
    expect(ids(stop.search('это он'))).toEqual(['a']);
  });
});

describe('highlights', () => {
  const index = indexOf(
    makeCapture({
      id: 'c',
      title: 'Разговор с Маше',
      text: 'Пообещал Маше позвонить в пятницу. Ещё раз: Маша ждёт звонка.',
    }),
  );

  it('reports positions in the original text, case and ё included', () => {
    const [hit] = index.search('обещал маша');
    expect(hit).toBeDefined();
    expect(marked(hit!, 'text')).toEqual(['Пообещал', 'Маше', 'Маша']);
    expect(marked(hit!, 'title')).toEqual(['Маше']);
  });

  it('marks the words of the title and builds an excerpt from another field', () => {
    const [hit] = index.search('маша');
    expect(hit!.title).toBe('Разговор с Маше');
    expect(hit!.titleRanges.map(([start, end]) => hit!.title.slice(start, end))).toEqual(['Маше']);
    expect(hit!.snippet?.field).toBe('text');
    expect(hit!.snippet!.ranges.map(([start, end]) => hit!.snippet!.text.slice(start, end))).toEqual(['Маше', 'Маша']);
  });

  it('highlights a whole word when only its beginning was typed', () => {
    const [hit] = index.search('позвон');
    expect(marked(hit!, 'text')).toEqual(['позвонить', 'звонка']);
  });

  it('splits a text into plain and matching pieces', () => {
    const [hit] = index.search('пятницу');
    const text = hit!.highlights.find((highlight) => highlight.field === 'text')!;
    const pieces = splitByRanges(text.text, text.ranges);
    expect(pieces.filter((piece) => piece.match).map((piece) => piece.text)).toEqual(['пятницу']);
    expect(pieces.map((piece) => piece.text).join('')).toBe(text.text);
  });

  it('labels a capture without a title by its first line and marks it', () => {
    const untitled = indexOf(makeCapture({ id: 'u', text: 'Идея про лендинг\nВторая строка про цены' }));
    const [hit] = untitled.search('лендинг');
    expect(hit!.title).toBe('Идея про лендинг');
    expect(hit!.titleRanges.map(([start, end]) => hit!.title.slice(start, end))).toEqual(['лендинг']);
  });

  it('cuts a long text around the match', () => {
    const filler = 'слово '.repeat(60);
    const long = indexOf(makeCapture({ id: 'l', text: `${filler}важная договорённость ${filler}` }));
    const [hit] = long.search('договорённость');
    const snippet = hit!.snippet!;
    expect(snippet.text.length).toBeLessThanOrEqual(142);
    expect(snippet.text.startsWith('…')).toBe(true);
    expect(snippet.text.endsWith('…')).toBe(true);
    expect(snippet.ranges.map(([start, end]) => snippet.text.slice(start, end))).toEqual(['договорённость']);
  });
});

describe('ranking', () => {
  it('puts a title match above a match in the middle of a text', () => {
    const index = indexOf(
      makeCapture({ id: 'in-text', text: 'Долго думал про цены и про всё остальное' }),
      makeCapture({ id: 'in-title', title: 'Цены', text: 'Заметка' }),
    );
    expect(ids(index.search('цены'))).toEqual(['in-title', 'in-text']);
  });

  it('puts an exact word above a longer word and a typo', () => {
    const index = indexOf(
      makeCapture({ id: 'typo', text: 'Клиэнты' }),
      makeCapture({ id: 'prefix', text: 'Клиентская база' }),
      makeCapture({ id: 'exact', text: 'Клиент' }),
    );
    const found = ids(index.search('клиент'));
    expect(found[0]).toBe('exact');
    expect(found.slice(1).sort()).toEqual(['prefix', 'typo']);
  });

  it('prefers the fresher of two equally good results, and the better one when freshness is off', () => {
    const index = indexOf(
      makeCapture({ id: 'old', text: 'Цены', createdAt: '2025-01-01T10:00:00.000Z', updatedAt: '2025-01-01T10:00:00.000Z' }),
      makeCapture({ id: 'new', text: 'Цены и ещё несколько лишних слов вокруг', createdAt: '2026-10-06T10:00:00.000Z', updatedAt: '2026-10-06T10:00:00.000Z' }),
    );
    expect(ids(index.search('цены', { now: NOW }))).toEqual(['new', 'old']);
    expect(ids(index.search('цены', { now: NOW, freshness: 0 }))).toEqual(['old', 'new']);
  });

  it('puts the person above captures that merely mention the name', () => {
    const index = indexOf(
      makeCapture({ id: 'c', text: 'Разговаривал с Машей про ученика' }),
      makePerson({ id: 'p', name: 'Маша' }),
    );
    expect(ids(index.search('маша'))[0]).toBe('p');
  });

  it('searches aliases and notes of people and keywords of projects', () => {
    const index = indexOf(
      makePerson({ id: 'p', name: 'Мария Петрова', aliases: ['Маша'], notes: 'Мама ученика Димы' }),
      makeProject({ id: 'pr', name: 'Онлайн-школа', description: 'Курсы по математике', keywords: ['okr', 'консультантство'] }),
    );
    expect(ids(index.search('маша'))).toEqual(['p']);
    expect(ids(index.search('ученика димы'))).toEqual(['p']);
    expect(ids(index.search('okr'))).toEqual(['pr']);
    expect(ids(index.search('онлайн'))).toEqual(['pr']);
  });

  it('honours the limit and returns the best ones', () => {
    const records = Array.from({ length: 8 }, (_, number) => makeCapture({ id: `c${number}`, text: `цены ${number}` }));
    const index = indexOf(...records);
    expect(index.search('цены')).toHaveLength(8);
    expect(index.search('цены', { limit: 3 })).toHaveLength(3);
    expect(index.search('цены', { limit: 0 })).toEqual([]);
  });
});

describe('filters', () => {
  const index = indexOf(
    makeCapture({ id: 'c1', text: 'Цены на курсы', day: '2026-10-01', personIds: ['masha'], projectIds: ['school'], tags: ['Деньги'], kind: 'voice' }),
    makeCapture({ id: 'c2', text: 'Цены конкурентов', day: '2026-10-05', personIds: ['dima'], tags: ['рынок'] }),
    makeCapture({ id: 'c3', text: 'Цены и скидки', day: '2026-10-09', projectIds: ['school'], tags: ['#деньги'] }),
    makeItem({ id: 'i1', title: 'Пересмотреть цены', createdAt: '2026-10-05T09:00:00.000Z', personIds: ['masha'] }),
    makeItem({ id: 'i2', title: 'Обсудить цены', status: 'done', createdAt: '2026-10-09T09:00:00.000Z', projectIds: ['school'] }),
    makeItem({ id: 'i3', title: 'Цены: черновик', status: 'proposed', kind: 'idea', createdAt: '2026-10-02T09:00:00.000Z' }),
    makePerson({ id: 'masha', name: 'Маша', notes: 'Спрашивала про цены' }),
    makeProject({ id: 'school', name: 'Школа', description: 'Цены и тарифы' }),
  );
  const found = (filters: NonNullable<Parameters<SearchIndex['search']>[1]>) => ids(index.search('цены', { ...filters, now: NOW })).sort();

  it('restricts to kinds of records', () => {
    expect(found({ kinds: ['person'] })).toEqual(['masha']);
    expect(found({ kinds: ['project', 'person'] })).toEqual(['masha', 'school']);
    expect(found({ kinds: ['capture'] })).toEqual(['c1', 'c2', 'c3']);
  });

  it('restricts to a range of days; people and projects have no day and drop out', () => {
    expect(found({ filters: { fromDay: '2026-10-05' } })).toEqual(['c2', 'c3', 'i1', 'i2']);
    expect(found({ filters: { toDay: '2026-10-05' } })).toEqual(['c1', 'c2', 'i1', 'i3']);
    expect(found({ filters: { fromDay: '2026-10-02', toDay: '2026-10-06' } })).toEqual(['c2', 'i1', 'i3']);
  });

  it('restricts to a person or a project, the person or project included', () => {
    expect(found({ filters: { personId: 'masha' } })).toEqual(['c1', 'i1', 'masha']);
    expect(found({ filters: { projectId: 'school' } })).toEqual(['c1', 'c3', 'i2', 'school']);
  });

  it('restricts to a tag whatever its case and hash', () => {
    expect(found({ filters: { tag: 'деньги' } })).toEqual(['c1', 'c3']);
    expect(found({ filters: { tag: '#Деньги' } })).toEqual(['c1', 'c3']);
  });

  it('restricts to kinds and statuses of items, and leaves out other records', () => {
    expect(found({ filters: { itemKind: 'task' } })).toEqual(['i1', 'i2']);
    expect(found({ filters: { itemKind: ['task', 'idea'] } })).toEqual(['i1', 'i2', 'i3']);
    expect(found({ filters: { itemStatus: 'proposed' } })).toEqual(['i3']);
    expect(found({ filters: { itemStatus: ['active', 'done'] } })).toEqual(['i1', 'i2']);
  });

  it('restricts to kinds of captures', () => {
    expect(found({ filters: { captureKind: 'voice' } })).toEqual(['c1']);
  });

  it('combines filters', () => {
    expect(found({ kinds: ['item'], filters: { projectId: 'school', fromDay: '2026-10-09' } })).toEqual(['i2']);
    expect(found({ filters: { personId: 'masha', tag: 'деньги' } })).toEqual(['c1']);
  });
});

describe('what is indexed', () => {
  it('skips trashed records and dismissed items', () => {
    const index = indexOf(
      makeCapture({ id: 'gone', text: 'Цены', deletedAt: '2026-10-02T00:00:00.000Z' }),
      makeItem({ id: 'no', title: 'Цены', status: 'dismissed' }),
      makeItem({ id: 'trashed', title: 'Цены', deletedAt: '2026-10-02T00:00:00.000Z' }),
      makePerson({ id: 'p', name: 'Цены', deletedAt: '2026-10-02T00:00:00.000Z' }),
      makeProject({ id: 'pr', name: 'Цены', deletedAt: '2026-10-02T00:00:00.000Z' }),
    );
    expect(index.size).toBe(0);
  });

  it('searches the parts of an item outside title and body: a decision, a counterparty, an answer', () => {
    const decision = makeItem({
      id: 'd',
      title: 'Решение про тариф',
      kind: 'decision',
      chosen: 'Оставить подписку',
      alternatives: ['Разовые платежи'],
      reasons: ['Предсказуемый доход'],
    });
    const commitment = makeItem({
      id: 'm',
      title: 'Отправить договор',
      kind: 'commitment',
      direction: 'i_owe',
      counterpartyName: 'Борис Сергеевич',
    });
    const index = indexOf(decision, commitment);
    expect(ids(index.search('предсказуемый доход'))).toEqual(['d']);
    expect(ids(index.search('подписку'))).toEqual(['d']);
    expect(ids(index.search('борис'))).toEqual(['m']);
  });

  it('finds items by tags and quotes', () => {
    const index = indexOf(makeItem({ id: 't', title: 'Задача', tags: ['учёба'], quote: 'надо повторить интегралы' }));
    expect(ids(index.search('учеба'))).toEqual(['t']);
    expect(ids(index.search('интегралы'))).toEqual(['t']);
  });
});

describe('maintaining the index', () => {
  it('replaces an entry, removes one and tells subscribers once per change', () => {
    const index = new SearchIndex();
    const seen: number[] = [];
    const unsubscribe = index.subscribe(() => seen.push(index.version));

    const first = entryOf('captures', makeCapture({ id: 'a', text: 'про цены' }))!;
    index.update([first]);
    expect(ids(index.search('цены'))).toEqual(['a']);

    index.update([{ ...first, fields: { text: 'про скидки' }, version: '2026-10-02T00:00:00.000Z' }]);
    expect(index.search('цены')).toEqual([]);
    expect(ids(index.search('скидки'))).toEqual(['a']);
    expect(index.size).toBe(1);

    index.update([], [first.key, 'capture:unknown']);
    expect(index.size).toBe(0);
    index.update([], ['capture:unknown']);

    unsubscribe();
    index.update([first]);
    expect(seen).toEqual([1, 2, 3]);
  });

  it('forgets everything on clear', () => {
    const index = indexOf(makeCapture({ id: 'a', text: 'цены' }), makePerson({ id: 'p', name: 'Маша' }));
    index.clear();
    expect(index.size).toBe(0);
    expect(index.search('цены')).toEqual([]);
  });
});
