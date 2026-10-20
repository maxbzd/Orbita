import { beforeEach, describe, expect, it } from 'vitest';
import { wipeAll } from './maintenance';
import { NotFoundError } from './internal';
import {
  audioRepo,
  capturesRepo,
  checkinsRepo,
  linksRepo,
  patternsRepo,
  presetsRepo,
  profileRepo,
  reviewsRepo,
  usageRepo,
} from './repos';

beforeEach(wipeAll);

describe('check-ins', () => {
  it('derives the day from the instant, clamps the scales and defaults to manual', async () => {
    const checkIn = await checkinsRepo.create({ valence: -3, energy: 2, focus: 5, stress: -1, sleepHours: 30, at: '2026-10-07T12:00:00.000Z' });
    expect(checkIn).toMatchObject({ valence: -1, energy: 1, focus: 1, stress: 0, sleepHours: 24, origin: 'manual', tags: [] });
    expect(checkIn.day).toMatch(/^2026-10-0[78]$/);
  });

  it('lists a range of days oldest first, finds the latest and confirms AI suggestions', async () => {
    const early = await checkinsRepo.create({ valence: 0, energy: 0.5, at: '2026-10-05T08:00:00.000Z', day: '2026-10-05' });
    const late = await checkinsRepo.create({ valence: 0.5, energy: 0.7, at: '2026-10-06T21:00:00.000Z', day: '2026-10-06', origin: 'ai_suggested' });
    await checkinsRepo.create({ valence: 0, energy: 0.1, at: '2026-10-20T08:00:00.000Z', day: '2026-10-20' });

    expect((await checkinsRepo.listRange('2026-10-05', '2026-10-06')).map((c) => c.id)).toEqual([early.id, late.id]);
    expect((await checkinsRepo.listByDay('2026-10-06')).map((c) => c.id)).toEqual([late.id]);
    expect((await checkinsRepo.latest())?.day).toBe('2026-10-20');

    expect((await checkinsRepo.confirm(late.id)).origin).toBe('ai_confirmed');
    expect((await checkinsRepo.confirm(early.id)).origin).toBe('manual');
    await expect(checkinsRepo.confirm('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('keeps the scales valid on update and hides trashed check-ins', async () => {
    const checkIn = await checkinsRepo.create({ valence: 0, energy: 0.5, day: '2026-10-06' });
    expect((await checkinsRepo.update(checkIn.id, { energy: 9, focus: undefined })).energy).toBe(1);
    await checkinsRepo.remove(checkIn.id);
    expect(await checkinsRepo.listByDay('2026-10-06')).toEqual([]);
    expect(await checkinsRepo.latest()).toBeUndefined();
    await checkinsRepo.restore(checkIn.id);
    expect(await checkinsRepo.listByDay('2026-10-06')).toHaveLength(1);
  });
});

describe('patterns', () => {
  it('derives the seen days and occurrences from the evidence', async () => {
    const pattern = await patternsRepo.create({
      title: 'Прокрастинация вечером',
      description: 'd',
      kind: 'behavior',
      evidence: [
        { captureId: 'c2', day: '2026-10-05' },
        { captureId: 'c1', day: '2026-10-01' },
        { captureId: 'c3', day: '2026-10-09', quote: 'опять отложил' },
      ],
      confidence: 3,
    });
    expect(pattern).toMatchObject({ status: 'candidate', firstSeenDay: '2026-10-01', lastSeenDay: '2026-10-09', occurrences: 3, confidence: 1 });
  });

  it('lists by status, most recently seen first, and tracks the status the user picks', async () => {
    const a = await patternsRepo.create({ title: 'a', description: '', kind: 'trigger', firstSeenDay: '2026-10-01', lastSeenDay: '2026-10-02' });
    const b = await patternsRepo.create({ title: 'b', description: '', kind: 'trigger', firstSeenDay: '2026-10-01', lastSeenDay: '2026-10-08' });
    expect((await patternsRepo.list()).map((p) => p.id)).toEqual([b.id, a.id]);
    await patternsRepo.setStatus(a.id, 'confirmed');
    expect((await patternsRepo.list({ status: 'confirmed' })).map((p) => p.id)).toEqual([a.id]);
  });

  it('destroy removes the pattern and its links', async () => {
    const pattern = await patternsRepo.create({ title: 'a', description: '', kind: 'other' });
    await linksRepo.create({ from: pattern.id, to: 'x', kind: 'related' });
    await patternsRepo.destroy(pattern.id);
    expect(await patternsRepo.get(pattern.id)).toBeUndefined();
    expect(await linksRepo.listFor('x')).toEqual([]);
  });
});

describe('reviews', () => {
  const base = { period: 'week', startDay: '2026-10-05', endDay: '2026-10-11' } as const;

  it('keeps one review per period and regenerates it in place, keeping the answers', async () => {
    const first = await reviewsRepo.upsert({ ...base, headline: 'Неделя', questions: ['Что получилось?'] });
    await reviewsRepo.saveAnswer(first.id, { question: 'Что получилось?', answer: 'Запустил курс' });

    const regenerated = await reviewsRepo.upsert({ ...base, headline: 'Неделя 2', generatedBy: 'ai' });
    expect(regenerated.id).toBe(first.id);
    expect(regenerated).toMatchObject({ headline: 'Неделя 2', generatedBy: 'ai', questions: [] });
    expect(regenerated.answers).toEqual([{ question: 'Что получилось?', answer: 'Запустил курс' }]);
    expect(regenerated.createdAt).toBe(first.createdAt);
    expect(await reviewsRepo.list()).toHaveLength(1);
  });

  it('overwrites the answer to the same question and finds a review by period', async () => {
    const review = await reviewsRepo.upsert({ ...base });
    await reviewsRepo.saveAnswer(review.id, { question: 'Q', answer: 'один' });
    const saved = await reviewsRepo.saveAnswer(review.id, { question: 'Q', answer: 'два' });
    expect(saved.answers).toEqual([{ question: 'Q', answer: 'два' }]);
    expect((await reviewsRepo.find('week', base.startDay))?.id).toBe(review.id);
    expect(await reviewsRepo.find('month', base.startDay)).toBeUndefined();
  });

  it('a trashed review is not found but comes back when regenerated', async () => {
    const review = await reviewsRepo.upsert({ ...base });
    await reviewsRepo.remove(review.id);
    expect(await reviewsRepo.find('week', base.startDay)).toBeUndefined();
    const again = await reviewsRepo.upsert({ ...base });
    expect(again.id).toBe(review.id);
    expect(again.deletedAt).toBeUndefined();
  });

  it('lists the latest period first and filters by period', async () => {
    await reviewsRepo.upsert({ ...base });
    await reviewsRepo.upsert({ period: 'week', startDay: '2026-10-12', endDay: '2026-10-18' });
    await reviewsRepo.upsert({ period: 'month', startDay: '2026-10-01', endDay: '2026-10-31' });
    expect((await reviewsRepo.list({ period: 'week' })).map((r) => r.startDay)).toEqual(['2026-10-12', '2026-10-05']);
    expect(await reviewsRepo.list()).toHaveLength(3);
  });
});

describe('profile', () => {
  it('returns an empty profile until saved, then merges patches', async () => {
    expect(await profileRepo.get()).toMatchObject({ id: 'me', name: '', glossary: [] });
    await profileRepo.save({ name: 'Лев', goals: 'Онлайн-школа' });
    const saved = await profileRepo.save({ about: 'Консультант' });
    expect(saved).toMatchObject({ name: 'Лев', goals: 'Онлайн-школа', about: 'Консультант' });
    expect(saved.updatedAt > '1970-01-02').toBe(true);
  });

  it('cleans the glossary: trims, drops empty terms and repeats (case and ё do not matter)', async () => {
    const profile = await profileRepo.save({
      glossary: [{ term: ' OKR ', hint: ' экзамен ' }, { term: 'okr' }, { term: '' }, { term: 'Ёлка' }, { term: 'елка', hint: 'x' }, { term: 'KPI', hint: '  ' }],
    });
    expect(profile.glossary).toEqual([{ term: 'OKR', hint: 'экзамен' }, { term: 'Ёлка' }, { term: 'KPI' }]);
  });
});

describe('presets', () => {
  it('fills defaults, keeps names unique per call and sorts by name', async () => {
    const b = await presetsRepo.create({ name: 'Утренний разбор' });
    await presetsRepo.create({ name: 'Перед созвоном', windowDays: 7, privacy: 'initials' });
    expect(b).toMatchObject({ windowDays: 14, privacy: 'full', maxTokens: 8000, sections: [] });
    expect((await presetsRepo.list()).map((p) => p.name)).toEqual(['Перед созвоном', 'Утренний разбор']);
    await expect(presetsRepo.create({ name: ' ' })).rejects.toThrow('Название пресета не может быть пустым');
  });

  it('updates and removes', async () => {
    const preset = await presetsRepo.create({ name: 'A' });
    expect((await presetsRepo.update(preset.id, { maxTokens: 4000, id: 'other' } as never)).id).toBe(preset.id);
    expect((await presetsRepo.get(preset.id))?.maxTokens).toBe(4000);
    await presetsRepo.remove(preset.id);
    expect(await presetsRepo.get(preset.id)).toBeUndefined();
    await expect(presetsRepo.update(preset.id, { name: 'B' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('links', () => {
  it('is idempotent for the same triple and reads both directions', async () => {
    const first = await linksRepo.create({ from: 'a', to: 'b', kind: 'related' });
    const again = await linksRepo.create({ from: 'a', to: 'b', kind: 'related' });
    await linksRepo.create({ from: 'a', to: 'b', kind: 'caused' });
    await linksRepo.create({ from: 'c', to: 'a', kind: 'follows' });
    expect(again.id).toBe(first.id);
    expect(await linksRepo.listFrom('a')).toHaveLength(2);
    expect(await linksRepo.listTo('a')).toHaveLength(1);
    expect(await linksRepo.listFor('a')).toHaveLength(3);
    await linksRepo.removeFor('a');
    expect(await linksRepo.listFor('a')).toEqual([]);
  });

  it('refuses a link to itself', async () => {
    await expect(linksRepo.create({ from: 'a', to: 'a', kind: 'related' })).rejects.toThrow(RangeError);
  });
});

describe('usage', () => {
  it('records calls and totals them per local day', async () => {
    await usageRepo.record({ at: '2026-10-06T10:00:00.000Z', provider: 'anthropic', model: 'm', purpose: 'extract', inputTokens: 100, outputTokens: 20, costUsd: 0.01 });
    await usageRepo.record({ at: '2026-10-06T10:05:00.000Z', provider: 'anthropic', model: 'm', purpose: 'ask', inputTokens: 50, outputTokens: 5 });
    await usageRepo.record({ at: '2026-10-07T10:00:00.000Z', provider: 'openai-compat', model: 'w', purpose: 'transcribe', inputTokens: 0, outputTokens: 0, audioSec: 30 });

    const summary = await usageRepo.summaryByDay('2026-10-06', '2026-10-07', 'UTC');
    expect(summary).toEqual([
      { day: '2026-10-06', calls: 2, inputTokens: 150, outputTokens: 25, audioSec: 0, costUsd: 0.01 },
      { day: '2026-10-07', calls: 1, inputTokens: 0, outputTokens: 0, audioSec: 30, costUsd: 0 },
    ]);
    await usageRepo.clear();
    expect(await usageRepo.summaryByDay('2026-10-06', '2026-10-07', 'UTC')).toEqual([]);
  });
});

describe('audio', () => {
  it('stores one recording per capture and links it from the capture', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', text: '' });
    const first = await audioRepo.save(capture.id, new Blob(['aaa'], { type: 'audio/webm' }));
    expect(first).toMatchObject({ captureId: capture.id, mime: 'audio/webm', sizeBytes: 3 });
    expect((await capturesRepo.get(capture.id))?.audioId).toBe(first.id);

    const second = await audioRepo.save(capture.id, new Blob(['bbbb'], { type: 'audio/mp4' }));
    expect((await audioRepo.getForCapture(capture.id))?.id).toBe(second.id);
    expect(await audioRepo.get(first.id)).toBeUndefined();

    await audioRepo.remove(capture.id);
    expect(await audioRepo.getForCapture(capture.id)).toBeUndefined();
    expect((await capturesRepo.get(capture.id))?.audioId).toBeUndefined();
  });

  it('survives a crash: chunks are kept, listed as unfinished, and assembled in order', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', text: '' });
    await audioRepo.appendChunk({ captureId: capture.id, seq: 1, data: new Blob(['BB'], { type: 'audio/webm' }) });
    await audioRepo.appendChunk({ captureId: capture.id, seq: 0, data: new Blob(['AA'], { type: 'audio/webm' }) });
    await audioRepo.appendChunk({ captureId: capture.id, seq: 1, data: new Blob(['BBB'], { type: 'audio/webm' }) });

    const [unfinished] = await audioRepo.listUnfinished();
    expect(unfinished).toMatchObject({ captureId: capture.id, chunkCount: 2, sizeBytes: 5, mime: 'audio/webm' });

    const audio = await audioRepo.finalizeFromChunks(capture.id);
    expect(audio).toMatchObject({ sizeBytes: 5, chunks: 2, mime: 'audio/webm' });
    expect(await audio?.data.text()).toBe('AABBB');
    expect(await audioRepo.listUnfinished()).toEqual([]);
    expect(await audioRepo.finalizeFromChunks(capture.id)).toBeUndefined();
  });

  it('discards chunks of a cancelled recording', async () => {
    await audioRepo.appendChunk({ captureId: 'c', seq: 0, data: new Blob(['x']) });
    await audioRepo.discardChunks('c');
    expect(await audioRepo.listChunks('c')).toEqual([]);
  });
});
