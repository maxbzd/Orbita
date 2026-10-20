import { describe, expect, it } from 'vitest';
import { avatarInitial, contextCompleteness, nextSteps, weekCells, weekStats } from './model';

const profile = (over: Partial<Parameters<typeof contextCompleteness>[0]['profile']> = {}) => ({ name: '', about: '', goals: '', values: '', talkStyle: '', ...over });

describe('«Контекст N %»', () => {
  it('пустой профиль — 0 %, части в сумме дают ровно 100', () => {
    const empty = contextCompleteness({ profile: profile(), factCount: 0, confirmedPatternCount: 0 });
    expect(empty.percent).toBe(0);
    expect(empty.parts.reduce((sum, part) => sum + part.weight, 0)).toBe(100);
  });

  it('поле засчитывается, когда в нём настоящая фраза, а не пара букв', () => {
    const typed = contextCompleteness({ profile: profile({ name: 'Да', about: 'ок', goals: '   ' }), factCount: 0, confirmedPatternCount: 0 });
    expect(typed.percent).toBe(10); // only the name
    const written = contextCompleteness({
      profile: profile({ name: 'Дима', about: 'Консультант по математике, веду онлайн-школу', goals: 'Выйти на 40 учеников' }),
      factCount: 0,
      confirmedPatternCount: 0,
    });
    expect(written.percent).toBe(10 + 20 + 15);
  });

  it('факты и подтверждённые паттерны считаются пропорционально и упираются в потолок', () => {
    const some = contextCompleteness({ profile: profile(), factCount: 2, confirmedPatternCount: 1 });
    expect(some.parts.find((p) => p.id === 'facts')?.earned).toBe(8);
    expect(some.parts.find((p) => p.id === 'patterns')?.earned).toBe(5);
    const many = contextCompleteness({ profile: profile(), factCount: 40, confirmedPatternCount: 9 });
    expect(many.percent).toBe(35);
  });

  it('всё заполнено — ровно 100 %, а подсказки предлагают самое выгодное первым', () => {
    const full = contextCompleteness({
      profile: profile({ name: 'Дима', about: 'Консультант по математике', goals: 'Выйти на 40 учеников', values: 'Честность и свобода', talkStyle: 'Коротко и прямо' }),
      factCount: 5,
      confirmedPatternCount: 3,
    });
    expect(full.percent).toBe(100);
    expect(nextSteps(full)).toEqual([]);

    const start = contextCompleteness({ profile: profile({ name: 'Дима' }), factCount: 0, confirmedPatternCount: 0 });
    expect(nextSteps(start, 2).map((p) => p.id)).toEqual(['about', 'facts']);
  });

  it('аватар берёт первую букву имени', () => {
    expect(avatarInitial(' дима ')).toBe('Д');
    expect(avatarInitial('')).toBe('Я');
  });
});

describe('серия по неделям', () => {
  const today = '2026-10-08'; // Thursday; the week starts on Monday 2026-10-05

  it('неделя считается, если в ней есть хотя бы одна запись', () => {
    const cells = weekCells({ '2026-10-06': 2, '2026-09-30': 1, '2026-09-29': 0 }, today, 4);
    expect(cells.map((c) => [c.start, c.has, c.current])).toEqual([
      ['2026-09-14', false, false],
      ['2026-09-21', false, false],
      ['2026-09-28', true, false],
      ['2026-10-05', true, true],
    ]);
    expect(weekStats(cells)).toEqual({ withEntries: 2, total: 4, run: 2 });
  });

  it('пустая текущая неделя не обрывает серию, пустая прошлая — обрывает', () => {
    const gap = weekCells({ '2026-09-30': 1, '2026-09-10': 1 }, today, 5);
    expect(weekStats(gap)).toMatchObject({ withEntries: 2, run: 1 });
    const none = weekCells({}, today, 3);
    expect(weekStats(none)).toEqual({ withEntries: 0, total: 3, run: 0 });
  });
});
