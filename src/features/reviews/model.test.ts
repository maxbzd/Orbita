import { describe, expect, it } from 'vitest';
import type { Review, ReviewSection } from '../../domain/types';
import { buildSlides, maskNames, maskSlide, namePattern, readFacts, reviewNames, sectionLines, slideHasNames } from './model';

const NOW = '2026-10-09T10:00:00.000Z';

function review(period: Review['period'], sections: ReviewSection[], extra: Partial<Review> = {}): Review {
  const range =
    period === 'week'
      ? { startDay: '2026-10-05', endDay: '2026-10-11' }
      : period === 'month'
        ? { startDay: '2026-10-01', endDay: '2026-10-31' }
        : period === 'year'
          ? { startDay: '2026-01-01', endDay: '2026-12-31' }
          : { startDay: '2026-10-09', endDay: '2026-10-09' };
  return { id: 'r1', createdAt: NOW, updatedAt: NOW, period, ...range, headline: 'Неделя про цену', sections, questions: ['Что дальше?'], generatedBy: 'rules', ...extra };
}

const stats: ReviewSection = {
  id: 'stats',
  title: 'Цифры',
  kind: 'stats',
  body: '',
  data: { captures: 12, activeDays: 4, days: 7, words: 1066, voiceMinutes: 5, checkins: 5, itemsCreated: { decision: 2, idea: 3 }, itemsCreatedTotal: 26, done: 5, overdue: 2, openIOwe: 3, openOwedToMe: 1 },
};
const wins: ReviewSection = { id: 'wins', title: 'Что получилось', kind: 'wins', body: '• Закрыто: A\n• Закрыто: B' };
const overdue: ReviewSection = { id: 'overdue', title: 'Что просрочено', kind: 'overdue', body: '• Обещание: Позвонить Светлане (просрочено на 3 дня)' };
const people: ReviewSection = { id: 'people', title: 'Люди', kind: 'people', body: '• Светлана — 5 упоминаний', data: [{ id: 'p', name: 'Светлана', mentions: 5 }] };
const mood: ReviewSection = {
  id: 'mood',
  title: 'Состояние',
  kind: 'mood',
  body: '• 5 отметок: настроение приятное',
  data: [
    { day: '2026-10-06', valence: 0.3, energy: 0.5 },
    { day: '2026-10-07', valence: 0.6, energy: 0.5 },
  ],
};

describe('readFacts', () => {
  it('reads numbers from typed section data and falls back to the text for demo-shaped data', () => {
    const facts = readFacts(review('week', [stats, wins, overdue, people, mood]));
    expect(facts).toMatchObject({ captures: 12, activeDays: 4, days: 7, decisions: 2, ideas: 3, itemsTotal: 26, done: 5, overdue: 2, openIOwe: 3, topPerson: 'Светлана' });
    expect(facts.moodPoints).toHaveLength(2);
    expect(facts.moodAverage).toBeCloseTo(0.45);

    const demo = readFacts(review('week', [{ id: 's', title: 'Цифры', kind: 'stats', body: '', data: { captures: 9, activeDays: 3, items: 4 } }, wins, overdue]));
    expect(demo).toMatchObject({ captures: 9, itemsTotal: 4, done: 2, overdue: 1, days: 7 });
  });

  it('survives sections without data', () => {
    const facts = readFacts(review('week', [{ id: 'x', title: 'x', kind: 'stats', body: 'нет', data: 'garbage' }]));
    expect(facts.captures).toBe(0);
    expect(sectionLines({ id: 'w', title: 'w', kind: 'wins', body: '• a\n\n- b.. c' })).toEqual(['a', 'b. c']);
  });
});

describe('buildSlides', () => {
  const sections = [stats, wins, overdue, people, mood, { id: 'patterns', title: 'П', kind: 'patterns' as const, body: '• Откладываю — 3 раза' }];

  it('makes about five cards for a week and leaves out the empty ones', () => {
    const slides = buildSlides(review('week', sections), { today: '2026-10-09' });
    expect(slides.map((s) => s.id)).toEqual(['metrics', 'wins', 'overdue', 'patterns', 'mood']);
    const sparse = buildSlides(review('week', [stats]), { today: '2026-10-09' });
    expect(sparse.map((s) => s.id)).toEqual(['metrics']);
  });

  it('puts a model-written section after the numbers', () => {
    const written: ReviewSection = { id: 'ai-1', title: 'Что я заметил', kind: 'text', body: 'Цена держалась.' };
    expect(buildSlides(review('week', [written, ...sections]), { today: '2026-10-09' }).map((s) => s.id).slice(0, 2)).toEqual(['metrics', 'written']);
  });

  it('builds the month as a poster, a phrase, the glass metrics with the comparison, then highlights', () => {
    const slides = buildSlides(review('month', sections, { headline: 'Тихий октябрь' }), {
      today: '2026-10-09',
      monthMoods: [1, null],
      compare: { dayOfMonth: 9, now: 16, before: 7, beforeMonth: 'сентябрь', full: false },
    });
    expect(slides.map((s) => s.type)).toEqual(['poster', 'text', 'metrics', 'list', 'list']);
    const poster = slides[0];
    expect(poster).toMatchObject({ type: 'poster', month: 10, year: 2026, phrase: 'Тихий октябрь' });
    const metrics = slides[2];
    expect(metrics.type === 'metrics' && metrics.compare).toMatchObject({ caption: 'На 9-е число', now: 16, before: 7, beforeLabel: 'Сентябрь' });
    expect(metrics.type === 'metrics' && metrics.metrics.map((m) => m.label)).toEqual(['Решений', 'Дел закрыто', 'Идей', 'Состояние', 'Топ-человек']);
  });

  it('builds the year as a cover, a passport with real numbers and the cards', () => {
    const slides = buildSlides(review('year', sections), { today: '2026-10-09' });
    expect(slides.slice(0, 2).map((s) => s.type)).toEqual(['cover', 'passport']);
    const passport = slides[1];
    expect(passport).toMatchObject({ type: 'passport', year: 2026, issuedOn: '2026-10-09', hero: { value: 12 } });
    expect(passport.type === 'passport' && passport.stats.map((s) => s.value)).toEqual([4, 5, 2, 0]);
  });

  it('builds the day as a ticket with the two moods', () => {
    const slides = buildSlides(review('day', sections), { today: '2026-10-09', dayMood: { from: 1, to: -1 } });
    expect(slides[0]).toMatchObject({ type: 'ticket', from: 1, to: -1, date: '2026-10-09', hero: { value: 12 } });
  });

  it('still makes a numbers card for an empty period', () => {
    const slides = buildSlides(review('week', [], { questions: [] }), { today: '2026-10-09' });
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({ type: 'metrics', hero: { value: '0' } });
  });
});

describe('hiding names', () => {
  const names = ['Светлана', 'Николай Петрович', 'Ян'];

  it('masks names in any common Russian ending, whole words only', () => {
    expect(maskNames('Позвонить Светлане и написать Светланы маме', names)).toBe('Позвонить ••• и написать ••• маме');
    expect(maskNames('Николай Петрович обещал, Николая Петровича ждём', names)).toBe('••• ••• обещал, ••• ••• ждём');
    expect(maskNames('Светланование и яндекс', names)).toBe('Светланование и яндекс');
    expect(maskNames('Ян сказал', names)).toBe('••• сказал');
    expect(maskNames('Янтарь', names)).toBe('Янтарь');
    expect(maskNames('без имён', [])).toBe('без имён');
    expect(namePattern(['a'])).toBeNull();
  });

  it('masks every text of a slide but not its structure', () => {
    const [metrics, , overdueSlide] = buildSlides(review('week', [stats, wins, overdue, people]), { today: '2026-10-09' });
    expect(metrics).toBeDefined();
    expect(overdueSlide).toBeDefined();
    const spec = overdueSlide!;
    expect(slideHasNames(spec, ['Светлана'])).toBe(true);
    const masked = maskSlide(spec, ['Светлана']);
    expect(masked.id).toBe(spec.id);
    expect(masked.type).toBe(spec.type);
    expect(JSON.stringify(masked)).not.toContain('Светлан');
    expect(JSON.stringify(masked)).toContain('•••');
    expect(slideHasNames(masked, ['Светлана'])).toBe(false);
    expect(slideHasNames(spec, [])).toBe(false);
  });

  it('collects names from the people table, aliases and section data', () => {
    const found = reviewNames(review('week', [people, { ...overdue, data: [{ person: 'Тимур' }] }]), [{ name: 'Алиса', aliases: ['Лиса'] }]);
    expect(found.sort()).toEqual(['Тимур', 'Лиса', 'Алиса', 'Светлана'].sort());
  });
});
