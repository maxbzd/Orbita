import { describe, expect, it } from 'vitest';
import type { CheckIn, ItemOfKind, Person } from '../../domain/types';
import { coMentionLinks, commitmentsOf, dueText, filterPeople, mergeCandidates, parseAliases, peopleStats, relationSeries, relationWord, toLinesPeople } from './model';

const person = (id: string, name: string, extra: Partial<Person> = {}): Person =>
  ({ id, name, aliases: [], role: 'client', mentionCount: 1, createdAt: '', updatedAt: '', ...extra }) as Person;

const commitment = (id: string, direction: 'i_owe' | 'owed_to_me', extra: Partial<ItemOfKind<'commitment'>> = {}): ItemOfKind<'commitment'> =>
  ({ id, kind: 'commitment', status: 'active', title: id, direction, personIds: [], projectIds: [], tags: [], createdAt: '2026-10-01T00:00:00Z', updatedAt: '', ...extra }) as ItemOfKind<'commitment'>;

describe('people list', () => {
  const people = [person('a', 'Анна Петрова', { aliases: ['Аня'] }), person('b', 'Борис', { role: 'family' })];

  it('searches by name, alias and case form; filters by role', () => {
    expect(filterPeople(people, 'аня', 'all').map((p) => p.id)).toEqual(['a']);
    expect(filterPeople(people, 'Бориса', 'all').map((p) => p.id)).toEqual(['b']);
    expect(filterPeople(people, '', 'family').map((p) => p.id)).toEqual(['b']);
    expect(filterPeople(people, 'Ксения', 'all')).toEqual([]);
  });

  it('active and dormant by the last mention', () => {
    const stats = peopleStats(
      [person('a', 'А', { lastMentionAt: '2026-10-05T10:00:00Z' }), person('b', 'Б', { lastMentionAt: '2026-07-01T10:00:00Z' }), person('c', 'В')],
      '2026-10-08',
    );
    expect(stats).toEqual({ total: 3, active: 1, dormant: 1 });
  });

  it('arcs join people of one record, once per pair', () => {
    const links = coMentionLinks([{ personIds: ['a', 'b', 'c'] }, { personIds: ['b', 'a'] }, { personIds: ['a'] }]);
    expect(links).toHaveLength(3);
    expect(links).toContainEqual({ a: 'a', b: 'b' });
  });

  it('lines carry the mention times in order', () => {
    const [line] = toLinesPeople([person('a', 'А')], [
      { personIds: ['a'], createdAt: '2026-10-02T00:00:00Z' },
      { personIds: ['a'], createdAt: '2026-10-01T00:00:00Z' },
    ]);
    expect(line!.mentionTimes).toEqual([Date.parse('2026-10-01T00:00:00Z'), Date.parse('2026-10-02T00:00:00Z')]);
  });
});

describe('the card of a person', () => {
  it('open commitments in both directions: by counterparty or by mention; closed ones stay out', () => {
    const all = [
      commitment('owe-1', 'i_owe', { counterpartyId: 'p', dueAt: '2026-10-10T00:00:00Z' }),
      commitment('owe-0', 'i_owe', { personIds: ['p'], dueAt: '2026-10-05T00:00:00Z' }),
      commitment('owed', 'owed_to_me', { counterpartyId: 'p' }),
      commitment('done', 'i_owe', { counterpartyId: 'p', status: 'done' }),
      commitment('other', 'i_owe', { counterpartyId: 'q' }),
    ];
    const result = commitmentsOf('p', all);
    expect(result.iOwe.map((c) => c.id)).toEqual(['owe-0', 'owe-1']);
    expect(result.owedToMe.map((c) => c.id)).toEqual(['owed']);
  });

  it('lateness is said in words', () => {
    expect(dueText('2026-10-05T12:00:00', '2026-10-08')).toEqual({ text: 'просрочено на 3 дня', overdue: true });
    expect(dueText(undefined)).toEqual({ text: 'без срока', overdue: false });
    expect(dueText('2026-10-08T12:00:00', '2026-10-08').text).toBe('срок сегодня');
  });

  it('the relation line is the mood of the days the person came up, gaps kept', () => {
    const captures = [
      { personIds: ['p'], day: '2026-10-01' },
      { personIds: ['p'], day: '2026-10-01' },
      { personIds: ['p'], day: '2026-10-02' },
      { personIds: ['q'], day: '2026-10-03' },
      { personIds: ['p'], day: '2026-10-04' },
    ];
    const checkIns = [
      { day: '2026-10-01', valence: 0.5, origin: 'manual' },
      { day: '2026-10-01', valence: -0.5, origin: 'manual' },
      { day: '2026-10-04', valence: 1, origin: 'ai_suggested' },
    ] as CheckIn[];
    expect(relationSeries('p', captures, checkIns)).toEqual([0, null, null]);
    expect(relationWord(0.5)).toBe('тёплые');
    expect(relationWord(-0.5)).toBe('напряжённые');
    expect(relationWord(undefined)).toBe('не оценены');
  });

  it('duplicates: likely ones first', () => {
    const me = person('1', 'Маша Иванова');
    const others = [person('2', 'Борис', { mentionCount: 9 }), person('3', 'Маша', { mentionCount: 2 }), me];
    expect(mergeCandidates(me, others).map((c) => [c.person.id, c.likely])).toEqual([
      ['3', true],
      ['2', false],
    ]);
  });

  it('aliases are split by commas and line breaks', () => {
    expect(parseAliases('Маша, Машенька;\n  Мэри ,')).toEqual(['Маша', 'Машенька', 'Мэри']);
  });
});
