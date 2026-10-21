import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo, checkinsRepo, itemsRepo, patternsRepo, peopleRepo, reviewsRepo, usageRepo, wipeAll } from '../db';
import type { ID } from '../domain/types';
import { AbortedError, BadResponseError, NoKeyError } from './errors';
import { buildReviewDigest, generateReview, isEmptyDigest, rulesReview } from './reviews';
import { createMockLlmProvider } from './providers/mock';
import type { LlmProvider } from './providers/types';
import { recordLlmUsage } from './usage';

// Week Mon 2026-10-05 … Sun 2026-10-11, looked at on Friday the 9th.
const ANCHOR = '2026-10-07';
const NOW = new Date('2026-10-09T12:00:00Z');
const at = (day: string, time = '10:00:00') => `${day}T${time}Z`;

const llm = (): LlmProvider => createMockLlmProvider({ onUsage: recordLlmUsage });
const failing = (error: Error): LlmProvider => ({
  id: 'mock',
  structured: () => Promise.reject(error),
  chat: () => Promise.reject(error),
  test: () => Promise.resolve({ ok: true, message: '' }),
});

let mashaId: ID;
let igorId: ID;

async function seedWeek() {
  const masha = await peopleRepo.create({ name: 'Маша', role: 'family', relationMood: 0.6 });
  const igor = await peopleRepo.create({ name: 'Борис', role: 'teammate' });
  mashaId = masha.id;
  igorId = igor.id;

  await capturesRepo.create({ kind: 'voice', day: '2026-10-05', createdAt: at('2026-10-05'), text: 'Один два три четыре пять', durationSec: 180, personIds: [masha.id], tags: ['тестовые', 'цены'] });
  await capturesRepo.create({ kind: 'text', day: ANCHOR, createdAt: at(ANCHOR), text: 'Шесть семь восемь', personIds: [masha.id, igor.id], tags: ['тестовые'] });
  await capturesRepo.create({ kind: 'text', day: '2026-10-08', createdAt: at('2026-10-08'), text: 'Девять', personIds: [masha.id], tags: [] });
  // Outside of the week: must not count.
  await capturesRepo.create({ kind: 'text', day: '2026-09-30', createdAt: at('2026-09-30'), text: 'Давно', personIds: [igor.id], tags: ['цены'] });

  // Overdue: promised to Маша, due on Tuesday; one more owed to me by Борис in the future.
  await itemsRepo.create({ kind: 'commitment', title: 'Прислать план Маше', direction: 'i_owe', counterpartyId: masha.id, personIds: [masha.id], dueAt: at('2026-10-06', '20:59:00'), createdAt: at('2026-10-05') });
  await itemsRepo.create({ kind: 'commitment', title: 'Борис пришлёт отчёт', direction: 'owed_to_me', counterpartyId: igor.id, personIds: [igor.id], dueAt: at('2026-10-20'), createdAt: at(ANCHOR) });
  // A proposal and a dismissed object are not "created".
  await itemsRepo.create({ kind: 'idea', title: 'Предложенная идея', status: 'proposed', stage: 'spark', relatedIds: [], createdAt: at(ANCHOR) });
  await itemsRepo.create({ kind: 'idea', title: 'Отклонённая идея', status: 'dismissed', stage: 'spark', relatedIds: [], createdAt: at(ANCHOR) });
  await itemsRepo.create({ kind: 'idea', title: 'Мини-группа по KPI', stage: 'spark', relatedIds: [], createdAt: at(ANCHOR) });

  // Wins: a finished task, a prediction that went the way it leaned, a decision that worked out.
  await itemsRepo.create({ kind: 'task', title: 'Обновить прайс', status: 'done', doneAt: at('2026-10-08'), createdAt: at('2026-10-05') });
  await itemsRepo.create({ kind: 'decision', title: 'Пробные только по вторникам', chosen: 'вторники', outcome: { rating: 5, note: 'работает', at: at('2026-10-08', '15:00:00') }, createdAt: at('2026-10-05') });

  // Closed predictions for calibration: five in total, three closed this week.
  const closed: [number, 'true' | 'false', string][] = [
    [0.8, 'true', '2026-10-08'],
    [0.9, 'false', '2026-10-07'],
    [0.7, 'false', '2026-10-06'],
    [0.8, 'true', '2026-09-20'],
    [0.2, 'false', '2026-09-10'],
  ];
  for (const [probability, outcome, day] of closed) {
    await itemsRepo.create({ kind: 'prediction', title: `Прогноз ${probability} ${outcome}`, probability, outcome, resolvedAt: at(day), createdAt: at('2026-09-01') });
  }

  await checkinsRepo.create({ valence: 0.6, energy: 0.8, day: '2026-10-05', at: at('2026-10-05') });
  await checkinsRepo.create({ valence: 0.4, energy: 0.7, day: '2026-10-06', at: at('2026-10-06') });
  await checkinsRepo.create({ valence: -0.4, energy: 0.3, stress: 0.7, day: '2026-10-08', at: at('2026-10-08') });
  await checkinsRepo.create({ valence: -0.6, energy: 0.2, day: '2026-10-09', at: at('2026-10-09') });

  await patternsRepo.create({ title: 'Откладывает звонки родителям', description: 'Звонки переносятся на вечер', kind: 'behavior', confidence: 0.6, occurrences: 3, lastSeenDay: '2026-10-08', firstSeenDay: '2026-09-20' });
  await patternsRepo.create({ title: 'Старый паттерн', description: 'Не в эту неделю', kind: 'other', confidence: 0.7, lastSeenDay: '2026-09-01' });
  await patternsRepo.create({ title: 'Отклонённый', description: 'Не показываем', kind: 'other', confidence: 0.9, status: 'rejected', lastSeenDay: '2026-10-08' });
}

beforeEach(wipeAll);

describe('buildReviewDigest', () => {
  beforeEach(seedWeek);

  it('counts what happened in the period and nothing outside it', async () => {
    const { stats, period, startDay, endDay } = await buildReviewDigest('week', ANCHOR, NOW);
    expect([period, startDay, endDay]).toEqual(['week', '2026-10-05', '2026-10-11']);
    expect(stats).toMatchObject({ captures: 3, activeDays: 3, days: 5, words: 9, voiceMinutes: 3, checkins: 4, done: 1, openIOwe: 1, openOwedToMe: 1 });
    // Proposals and dismissed objects are not counted as made.
    expect(stats.itemsCreated).toEqual({ commitment: 2, idea: 1, task: 1, decision: 1 });
    expect(stats.itemsCreatedTotal).toBe(5);
  });

  it('lists wins: finished work, calls that went the way they leaned, decisions that worked', async () => {
    const { wins } = await buildReviewDigest('week', ANCHOR, NOW);
    expect(wins.map((win) => win.title).sort()).toEqual(['Обновить прайс', 'Прогноз 0.8 true', 'Пробные только по вторникам'].sort());
    // 0.9 → false and 0.7 → false are misses, not wins.
    expect(wins.some((win) => win.title.includes('0.9'))).toBe(false);
  });

  it('lists what is overdue with the person and the number of days', async () => {
    const { overdue, stats } = await buildReviewDigest('week', ANCHOR, NOW);
    expect(stats.overdue).toBe(1);
    expect(overdue[0]).toMatchObject({ kind: 'commitment', title: 'Прислать план Маше', person: 'Маша', direction: 'i_owe' });
    expect(overdue[0].daysOverdue).toBeGreaterThanOrEqual(2);
  });

  it('judges a finished period at its end, not at this moment', async () => {
    const earlier = await buildReviewDigest('week', '2026-09-30', NOW);
    expect(earlier.overdue).toEqual([]);
    const lastDayOfWeek = await buildReviewDigest('week', ANCHOR, new Date('2026-11-01T12:00:00Z'));
    expect(lastDayOfWeek.overdue[0].daysOverdue).toBeLessThan(10);
  });

  it('describes the people of the period with their open promises', async () => {
    const { people } = await buildReviewDigest('week', ANCHOR, NOW);
    expect(people[0]).toMatchObject({ id: mashaId, name: 'Маша', mentions: 3, openIOwe: 1, openOwedToMe: 0, relationMood: 0.6 });
    expect(people[1]).toMatchObject({ id: igorId, mentions: 1, openIOwe: 0, openOwedToMe: 1 });
  });

  it('shows recent patterns that are not rejected, and the tags', async () => {
    const { patterns, themes } = await buildReviewDigest('week', ANCHOR, NOW);
    expect(patterns.map((pattern) => pattern.title)).toEqual(['Откладывает звонки родителям']);
    expect(themes).toEqual([{ tag: 'тестовые', count: 2 }, { tag: 'цены', count: 1 }]);
  });

  it('calibrates over all closed predictions and reports the ones of the period', async () => {
    const { calibration } = await buildReviewDigest('week', ANCHOR, NOW);
    expect(calibration.closedInPeriod).toBe(3);
    expect(calibration.overall.enough).toBe(true);
    expect(calibration.brierInPeriod).toBeCloseTo(((0.2) ** 2 + 0.9 ** 2 + 0.7 ** 2) / 3, 2);
  });

  it('summarizes the state: averages, extremes and the direction', async () => {
    const { mood } = await buildReviewDigest('week', ANCHOR, NOW);
    expect(mood).toMatchObject({ checkins: 4, bestDay: '2026-10-05', hardestDay: '2026-10-09', trend: 'down' });
    expect(mood?.valence).toBeCloseTo(0, 1);
    expect(mood?.byDay).toHaveLength(4);
  });

  it('knows a quiet period is empty', async () => {
    const quiet = await buildReviewDigest('week', '2026-08-12', NOW);
    expect(isEmptyDigest(quiet)).toBe(true);
    expect(quiet.mood).toBeNull();
  });
});

describe('rulesReview', () => {
  it('writes every section in Russian from the digest alone', async () => {
    await seedWeek();
    const digest = await buildReviewDigest('week', ANCHOR, NOW);
    const review = rulesReview(digest);

    expect(review.sections.map((section) => section.id)).toEqual(['stats', 'wins', 'overdue', 'patterns', 'people', 'calibration', 'mood']);
    expect(review.sections.map((section) => section.kind)).toEqual(['stats', 'wins', 'overdue', 'patterns', 'people', 'calibration', 'mood']);
    const body = (id: string) => review.sections.find((section) => section.id === id)?.body ?? '';
    expect(body('stats')).toContain('3 записи, 9 слов, голосом 3 мин. Активных дней: 3 из 5.');
    expect(body('stats')).toContain('1 решение, 2 обязательства, 1 идея, 1 задача');
    expect(body('wins')).toContain('Закрыто: Обновить прайс');
    expect(body('overdue')).toMatch(/Обещание: Прислать план Маше \(просрочено на \d+ (?:день|дня|дней); я должен: Маша\)/);
    expect(body('people')).toContain('Маша — 3 упоминания; я должен: 1; отношения тепло');
    expect(body('calibration')).toContain('Brier');
    expect(body('mood')).toContain('4 отметки');
    expect(body('mood')).toContain('снижалось');
    expect(review.headline).toBe('3 записи, закрыто 1, просрочено 1');
    expect(review.questions.length).toBeGreaterThanOrEqual(2);
    expect(review.questions.length).toBeLessThanOrEqual(3);
    expect(review.questions[0]).toContain('Прислать план Маше');
  });

  it('says plainly that calibration needs more data', async () => {
    await itemsRepo.create({ kind: 'prediction', title: 'Один', probability: 0.5, outcome: 'true', resolvedAt: at(ANCHOR), createdAt: at('2026-10-01') });
    const review = rulesReview(await buildReviewDigest('week', ANCHOR, NOW));
    expect(review.sections.find((section) => section.id === 'calibration')?.body).toContain('нужно 5 закрытых прогнозов, сейчас 1');
  });

  it('gives a quiet period a short honest review', async () => {
    const review = rulesReview(await buildReviewDigest('month', '2026-08-12', NOW));
    expect(review.headline).toBe('За этот период записей нет');
    expect(review.sections.map((section) => section.id)).toEqual(['stats']);
    expect(review.sections[0].body).toContain('Записей за период нет.');
    expect(review.questions).toHaveLength(2);
  });
});

describe('generateReview', () => {
  beforeEach(seedWeek);

  it('works without a model: rules only, stored, nothing sent anywhere', async () => {
    const { review, aiError, usage } = await generateReview('week', ANCHOR, { now: NOW });
    expect(review.generatedBy).toBe('rules');
    expect(aiError).toBeUndefined();
    expect(usage).toBeUndefined();
    expect(await reviewsRepo.find('week', '2026-10-05')).toMatchObject({ id: review.id, headline: review.headline });
  });

  it('adds the model\'s headline, written sections and questions in front of the computed ones', async () => {
    const provider = llm();
    const spy = vi.spyOn(provider, 'structured');
    const { review, usage } = await generateReview('week', ANCHOR, { llm: provider, now: NOW });

    expect(review.generatedBy).toBe('ai');
    expect(review.headline).toMatch(/записей/);
    expect(review.sections.slice(0, 2).every((section) => section.kind === 'text')).toBe(true);
    expect(review.sections.map((section) => section.kind)).toEqual(expect.arrayContaining(['stats', 'wins', 'overdue', 'calibration']));
    expect(review.questions.length).toBeGreaterThanOrEqual(2);
    expect(usage?.inputTokens).toBeGreaterThan(0);

    const request = spy.mock.calls[0][0];
    expect(request).toMatchObject({ purpose: 'review', tier: 'smart', schemaName: 'orbit_review' });
    expect(request.user).toContain('Период: неделя');
    expect(request.user).toContain('Прислать план Маше');
    expect((await usageRepo.listRange('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z')).map((row) => row.purpose)).toEqual(['review']);
  });

  it('falls back to the rules review when the model fails, and says why', async () => {
    const { review, aiError } = await generateReview('week', ANCHOR, { llm: failing(new BadResponseError('мусор')), now: NOW });
    expect(review.generatedBy).toBe('rules');
    expect(review.sections.length).toBeGreaterThan(3);
    expect(aiError).toMatch(/[а-яё]/i);
  });

  it('does not treat a missing key as an error of the review', async () => {
    const { review, aiError } = await generateReview('week', ANCHOR, { llm: failing(new NoKeyError()), now: NOW });
    expect(review.generatedBy).toBe('rules');
    expect(aiError).toContain('ключ');
  });

  it('lets cancellation through', async () => {
    await expect(generateReview('week', ANCHOR, { llm: failing(new AbortedError()), now: NOW })).rejects.toBeInstanceOf(AbortedError);
    expect(await reviewsRepo.find('week', '2026-10-05')).toBeUndefined();
  });

  it('does not call the model for an empty period or when told not to', async () => {
    const provider = llm();
    const spy = vi.spyOn(provider, 'structured');
    await generateReview('week', '2026-08-12', { llm: provider, now: NOW });
    await generateReview('week', ANCHOR, { llm: provider, useAi: false, now: NOW });
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the user\'s answers when the review is made again', async () => {
    const first = await generateReview('week', ANCHOR, { now: NOW });
    await reviewsRepo.saveAnswer(first.review.id, { question: first.review.questions[0], answer: 'Не успел' });
    const second = await generateReview('week', ANCHOR, { llm: llm(), now: NOW });
    expect(second.review.id).toBe(first.review.id);
    expect(second.review.answers).toEqual([{ question: first.review.questions[0], answer: 'Не успел' }]);
  });

  it('can show a review without keeping it', async () => {
    const { review } = await generateReview('week', ANCHOR, { now: NOW, save: false });
    expect(review.sections.length).toBeGreaterThan(0);
    expect(await reviewsRepo.list()).toEqual([]);
  });

  it('reviews a day, a month and a year', async () => {
    const day = await generateReview('day', ANCHOR, { now: NOW, save: false });
    expect(day.digest).toMatchObject({ startDay: ANCHOR, endDay: ANCHOR });
    expect(day.digest.stats.captures).toBe(1);
    const month = await generateReview('month', ANCHOR, { now: NOW, save: false });
    expect(month.digest).toMatchObject({ startDay: '2026-10-01', endDay: '2026-10-31' });
    const year = await generateReview('year', ANCHOR, { now: NOW, save: false });
    expect(year.digest.stats.captures).toBe(4);
  });
});
