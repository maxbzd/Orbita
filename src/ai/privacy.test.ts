import { describe, expect, it } from 'vitest';
import { createScrubber, initialsOf, letterLabel } from './privacy';

const person = (id: string, name: string, aliases: string[] = []) => ({ id, name, aliases });
const PEOPLE = [person('masha', 'Мария Иванова', ['Маша']), person('igor', 'Борис'), person('petya', 'Пётр Сидоров', ['Петя'])];

describe('labels', () => {
  it('makes initials of every part of the name', () => {
    expect(initialsOf('Мария Иванова')).toBe('М. И.');
    expect(initialsOf('  маша ')).toBe('М.');
    expect(initialsOf('123')).toBe('?');
  });

  it('counts letters like spreadsheet columns', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(letterLabel)).toEqual(['Человек A', 'Человек B', 'Человек Z', 'Человек AA', 'Человек AB', 'Человек AZ', 'Человек BA']);
  });
});

describe('createScrubber', () => {
  it('leaves everything as it is for full names', () => {
    const scrubber = createScrubber(PEOPLE, 'full');
    expect(scrubber.scrub('Обещал Маше')).toBe('Обещал Маше');
    expect(scrubber.scrubDeep({ a: ['Борис'] })).toEqual({ a: ['Борис'] });
    expect(scrubber.warnings).toEqual([]);
    expect(scrubber.labelOf('igor')).toBe('Борис');
  });

  it('masks a name in every case form, by full name, alias or first name', () => {
    const scrubber = createScrubber(PEOPLE, 'initials');
    const text = 'Обещал Маше. Говорил с Машей и с Марией Ивановой. Борис сказал, что Бориса не будет. Письмо от Марии.';
    expect(scrubber.scrub(text)).toBe('Обещал М. И.. Говорил с М. И. и с М. И.. Б. сказал, что Б. не будет. Письмо от М. И..');
    expect(scrubber.labelOf('masha')).toBe('М. И.');
  });

  it('numbers people as Человек A, B… in a stable order whatever order the list comes in', () => {
    const forward = createScrubber(PEOPLE, 'anonymous');
    const backward = createScrubber([...PEOPLE].reverse(), 'anonymous');
    const text = 'Борис, Мария и Петя встретились.';
    expect(forward.scrub(text)).toBe('Человек A, Человек B и Человек C встретились.');
    expect(backward.scrub(text)).toBe(forward.scrub(text));
    expect(forward.labelOf('petya')).toBe('Человек C');
  });

  it('finds ё and е alike and does not touch other words that merely start the same', () => {
    const scrubber = createScrubber([person('p', 'Фёдор'), person('i', 'Борис')], 'anonymous');
    expect(scrubber.scrub('Федор, Фёдора и Фёдору; бориспольский рейс и Бориски')).toBe('Человек B, Человек B и Человек B; бориспольский рейс и Бориски');
  });

  it('does not mistake a short name for a conjunction', () => {
    const scrubber = createScrubber([person('p', 'Ия'), person('y', 'Ян')], 'anonymous');
    expect(scrubber.scrub('Ия и Ян купили яна и ию')).toBe('Человек A и Человек B купили яна и ию');
  });

  it('masks every case form of a three-letter name', () => {
    const scrubber = createScrubber([person('o', 'Оля'), person('a', 'Аня')], 'anonymous');
    expect(scrubber.scrub('Позвонить Оле завтра, Олю и Олей видел; Ане, Аню, Ани')).toBe('Позвонить Человек B завтра, Человек B и Человек B видел; Человек A, Человек A, Человек A');
  });

  it('masks the author too', () => {
    expect(createScrubber(PEOPLE, 'anonymous', 'Фёдор').scrub('Фёдор решил. Для Фёдора важно.')).toBe('Автор решил. Для Автор важно.');
    expect(createScrubber(PEOPLE, 'initials', 'Фёдор Новиков').scrub('Фёдор решил.')).toBe('Ф. Н. решил.');
  });

  it('gives look-alike initials different labels', () => {
    const scrubber = createScrubber([person('a', 'Маша'), person('b', 'Миша')], 'initials');
    expect(scrubber.labelOf('a')).not.toBe(scrubber.labelOf('b'));
    expect(scrubber.scrub('Маша и Миша')).toBe('М. и М. (2)');
  });

  it('keeps one label for a first name two people share, and says so', () => {
    const scrubber = createScrubber([person('a', 'Маша Иванова'), person('b', 'Маша Петрова')], 'anonymous');
    expect(scrubber.scrub('Маша Петрова и просто Маша')).toBe('Человек B и просто Человек A');
    expect(scrubber.warnings.join(' ')).toContain('принадлежит нескольким людям');
  });

  it('masks names inside nested data and leaves other values alone', () => {
    const scrubber = createScrubber(PEOPLE, 'anonymous');
    expect(scrubber.scrubDeep({ title: 'Позвонить Борису', list: ['Маша', 3, null], nested: { ok: true, who: 'с Петей' } })).toEqual({
      title: 'Позвонить Человек A',
      list: ['Человек B', 3, null],
      nested: { ok: true, who: 'с Человек C' },
    });
  });

  it('warns that only people from the database are known', () => {
    expect(createScrubber(PEOPLE, 'initials').warnings.join(' ')).toContain('Имена, которых в базе нет');
  });

  it('works for an empty list of people', () => {
    const scrubber = createScrubber([], 'anonymous');
    expect(scrubber.scrub('Привет, мир')).toBe('Привет, мир');
  });
});
