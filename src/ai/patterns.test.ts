import { beforeEach, describe, expect, it, vi } from 'vitest';
import { capturesRepo, itemsRepo, patternsRepo, usageRepo, wipeAll } from '../db';
import type { Capture } from '../domain/types';
import { MIN_CAPTURES, findPatterns, mergeConfidence } from './patterns';
import { PatternsSchema } from './prompts/schemas';
import type { PatternDraft } from './prompts/schemas';
import { createMockLlmProvider } from './providers/mock';
import type { LlmProvider } from './providers/types';
import { recordLlmUsage } from './usage';

const NOW = new Date('2026-10-09T12:00:00Z');
const llm = (): LlmProvider => createMockLlmProvider({ onUsage: recordLlmUsage });

/** A provider that answers with fixed drafts, to test how answers are merged. */
function scripted(...drafts: Partial<PatternDraft>[]): LlmProvider {
  const patterns = drafts.map((draft) => ({ title: 'Паттерн', description: 'Описание', kind: 'behavior', confidence: 0.5, evidence: [], ...draft }));
  return {
    id: 'mock',
    structured: <T,>() => Promise.resolve({ data: PatternsSchema.parse({ patterns }) as T, usage: { provider: 'mock', model: 'mock', inputTokens: 1, outputTokens: 1 } }),
    chat: () => Promise.reject(new Error('not used')),
    test: () => Promise.resolve({ ok: true, message: '' }),
  };
}

const DAYS = ['2026-09-14', '2026-09-21', '2026-09-30', '2026-10-02', '2026-10-06', '2026-10-08'];

async function seed(): Promise<Capture[]> {
  const rows: [string, string, string[]][] = [
    [DAYS[0], 'Опять думал про цены на тестовые.', ['цены']],
    [DAYS[1], 'Разбирал расписание, много переносов.', ['расписание']],
    [DAYS[2], 'Поднимать цену страшно, откладываю решение.', ['цены']],
    [DAYS[3], 'Родители спрашивали про скидки.', ['родители']],
    [DAYS[4], 'Снова не решился поднять цену на тестовое.', ['цены']],
    [DAYS[5], 'Хороший день, провёл три урока.', []],
  ];
  const captures: Capture[] = [];
  for (const [day, text, tags] of rows) {
    captures.push(await capturesRepo.create({ kind: 'text', day, createdAt: `${day}T10:00:00Z`, text, tags, summary: text }));
  }
  return captures;
}

beforeEach(wipeAll);

describe('findPatterns', () => {
  it('stores a pattern that shows on several days, with its records as evidence', async () => {
    const captures = await seed();
    const result = await findPatterns({ llm: llm(), now: NOW });

    expect(result.examined).toBe(6);
    expect(result.created).toHaveLength(1);
    const [pattern] = result.created;
    expect(pattern).toMatchObject({ title: 'Повторяющаяся тема: цены', status: 'candidate', kind: 'recurring_topic', occurrences: 3, firstSeenDay: DAYS[0], lastSeenDay: DAYS[4] });
    expect(pattern.evidence.map((entry) => entry.captureId)).toEqual([captures[0].id, captures[2].id, captures[4].id]);
    expect(pattern.evidence.map((entry) => entry.day)).toEqual([DAYS[0], DAYS[2], DAYS[4]]);
    // Three records: not more than 0.7, as the prompt promises the model.
    expect(pattern.confidence).toBeLessThanOrEqual(0.7);
    expect(await patternsRepo.list()).toHaveLength(1);
    expect((await usageRepo.listRange('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z')).map((row) => row.purpose)).toEqual(['patterns']);
  });

  it('does not ask the model with too little to compare', async () => {
    const provider = llm();
    const spy = vi.spyOn(provider, 'structured');
    for (let index = 1; index < MIN_CAPTURES; index++) {
      await capturesRepo.create({ kind: 'text', day: `2026-10-0${index}`, createdAt: `2026-10-0${index}T10:00:00Z`, text: 'Запись' });
    }
    expect(await findPatterns({ llm: provider, now: NOW })).toMatchObject({ reason: 'not-enough-data', examined: MIN_CAPTURES - 1, created: [] });

    // Enough records, but all on one day: nothing to compare either.
    await wipeAll();
    for (let index = 0; index < MIN_CAPTURES; index++) {
      await capturesRepo.create({ kind: 'text', day: '2026-10-08', createdAt: `2026-10-08T1${index}:00:00Z`, text: 'Запись дня' });
    }
    expect(await findPatterns({ llm: provider, now: NOW })).toMatchObject({ reason: 'not-enough-data', examined: MIN_CAPTURES });
    expect(spy).not.toHaveBeenCalled();
  });

  it('only looks at the requested number of weeks', async () => {
    await seed();
    const provider = llm();
    const spy = vi.spyOn(provider, 'structured');
    const result = await findPatterns({ llm: provider, weeks: 2, now: NOW });
    expect(result.examined).toBe(4);
    expect(spy.mock.calls[0][0].user).not.toContain('2026-09-14');
    expect(spy.mock.calls[0][0].user).toContain('2026-09-30');
  });

  it('shows the model titles, summaries, tags, accepted objects and codes for known patterns', async () => {
    const [first] = await seed();
    await itemsRepo.create({ kind: 'decision', title: 'Подумать о цене', chosen: 'подумать', captureId: first.id });
    await itemsRepo.create({ kind: 'idea', title: 'Не должно попасть', status: 'proposed', stage: 'spark', relatedIds: [], captureId: first.id });
    const known = await patternsRepo.create({ title: 'Известный', description: 'Уже есть', kind: 'other', lastSeenDay: DAYS[0] });
    const provider = llm();
    const spy = vi.spyOn(provider, 'structured');
    await findPatterns({ llm: provider, now: NOW });

    const request = spy.mock.calls[0][0];
    expect(request).toMatchObject({ purpose: 'patterns', tier: 'smart', schemaName: 'orbit_patterns' });
    expect(request.user).toContain('- p1 [кандидат, other] Известный: Уже есть');
    expect(request.user).toContain(`### c1 — ${DAYS[0]} — Опять думал про цены на тестовые.`);
    expect(request.user).toContain('Теги: цены');
    expect(request.user).toContain('Объекты: decision: Подумать о цене');
    expect(request.user).not.toContain('Не должно попасть');
    expect(known.id).toBeTruthy();
  });

  describe('merging with what is known', () => {
    it('adds evidence to the same pattern instead of creating a second one', async () => {
      const captures = await seed();
      const first = await findPatterns({ llm: llm(), now: NOW });
      const again = await findPatterns({ llm: llm(), now: NOW });
      expect(again.created).toEqual([]);
      // Nothing new to add: the pattern is left exactly as it was.
      expect(again.updated).toEqual([]);

      const extra = await capturesRepo.create({ kind: 'text', day: '2026-10-09', createdAt: '2026-10-09T08:00:00Z', text: 'Опять про цены.', tags: ['цены'], summary: 'Опять про цены.' });
      const third = await findPatterns({ llm: llm(), now: NOW });

      expect(third.created).toEqual([]);
      expect(third.updated).toHaveLength(1);
      const [updated] = third.updated;
      expect(updated.id).toBe(first.created[0].id);
      expect(updated.occurrences).toBe(4);
      expect(updated.lastSeenDay).toBe('2026-10-09');
      expect(updated.firstSeenDay).toBe(DAYS[0]);
      expect(updated.evidence.map((entry) => entry.captureId)).toEqual([captures[0].id, captures[2].id, captures[4].id, extra.id]);
      expect(updated.confidence).toBeGreaterThan(first.created[0].confidence);
      expect(await patternsRepo.list()).toHaveLength(1);
    });

    it('never brings back a pattern the user rejected', async () => {
      await seed();
      const first = await findPatterns({ llm: llm(), now: NOW });
      await patternsRepo.setStatus(first.created[0].id, 'rejected');
      await capturesRepo.create({ kind: 'text', day: '2026-10-09', createdAt: '2026-10-09T08:00:00Z', text: 'Снова цены.', tags: ['цены'], summary: 'Снова цены.' });

      const result = await findPatterns({ llm: llm(), now: NOW });
      expect(result).toMatchObject({ created: [], updated: [], skipped: 1 });
      expect((await patternsRepo.get(first.created[0].id))?.status).toBe('rejected');
    });

    it('keeps what the user confirmed and wakes up a resolved pattern that is seen again', async () => {
      const captures = await seed();
      const a = captures[0];
      const confirmed = await patternsRepo.create({
        title: 'Боюсь поднимать цены',
        description: 'Моё описание',
        kind: 'behavior',
        status: 'confirmed',
        confidence: 0.8,
        suggestion: 'Мой шаг',
        evidence: [{ captureId: a.id, day: a.day }],
        lastSeenDay: DAYS[0],
        firstSeenDay: DAYS[0],
      });
      const resolved = await patternsRepo.create({ title: 'Переносы занятий', description: 'Старое', kind: 'behavior', status: 'resolved', evidence: [{ captureId: captures[1].id, day: DAYS[1] }], lastSeenDay: DAYS[1], firstSeenDay: DAYS[1] });
      const provider = scripted(
        { existingId: 'p2', title: 'Боюсь поднимать цены', description: 'Новое описание модели', suggestion: 'Шаг модели', confidence: 0.6, evidence: [{ ref: 'c3', quote: null }, { ref: 'c5', quote: null }] },
        { existingId: 'p1', title: 'Переносы занятий', description: 'Снова', confidence: 0.5, evidence: [{ ref: 'c2', quote: null }, { ref: 'c4', quote: null }, { ref: 'c6', quote: null }] },
      );
      // Known patterns are numbered by `lastSeenDay`, newest first: the resolved one saw its last day later, so it is p1.
      const result = await findPatterns({ llm: provider, now: NOW });

      const afterConfirmed = await patternsRepo.get(confirmed.id);
      expect(afterConfirmed).toMatchObject({ status: 'confirmed', description: 'Моё описание', suggestion: 'Мой шаг', occurrences: 3 });
      expect(afterConfirmed?.confidence).toBeGreaterThanOrEqual(0.8);
      const afterResolved = await patternsRepo.get(resolved.id);
      expect(afterResolved?.status).toBe('candidate');
      expect(result.updated).toHaveLength(2);
    });

    it('recognizes a known pattern by its title when the model forgets to name it', async () => {
      const captures = await seed();
      const known = await patternsRepo.create({ title: 'Откладывает решение о цене', description: 'Старое описание', kind: 'behavior', evidence: [{ captureId: captures[0].id, day: DAYS[0] }], lastSeenDay: DAYS[0], firstSeenDay: DAYS[0] });
      const result = await findPatterns({
        llm: scripted({ title: 'Откладывает решение о цене!', description: 'Уточнённое описание', suggestion: 'Назначить дату', evidence: [{ ref: 'c3' }, { ref: 'c5' }] }),
        now: NOW,
      });
      expect(result.created).toEqual([]);
      const updated = await patternsRepo.get(known.id);
      expect(updated).toMatchObject({ description: 'Уточнённое описание', suggestion: 'Назначить дату', occurrences: 3 });
    });
  });

  describe('distrusting the answer', () => {
    it('drops drafts without two different days of real evidence', async () => {
      await seed();
      const result = await findPatterns({
        llm: scripted(
          { title: 'Одна запись', evidence: [{ ref: 'c1' }] },
          { title: 'Выдуманные коды', evidence: [{ ref: 'c99' }, { ref: 'c100' }] },
          { title: 'Одна запись дважды', evidence: [{ ref: 'c1' }, { ref: 'c1' }] },
          { title: '   ', evidence: [{ ref: 'c1' }, { ref: 'c3' }] },
        ),
        now: NOW,
      });
      expect(result.created).toEqual([]);
      expect(result.skipped).toBe(4);
    });

    it('keeps real quotes and throws away invented ones', async () => {
      await seed();
      const { created } = await findPatterns({
        llm: scripted({ title: 'Страх цены', evidence: [{ ref: 'c3', quote: 'Поднимать цену страшно' }, { ref: 'c5', quote: 'Такой фразы никогда не было' }] }),
        now: NOW,
      });
      expect(created[0].evidence[0]).toMatchObject({ day: DAYS[2], quote: 'Поднимать цену страшно' });
      expect(created[0].evidence[1].quote).toBeUndefined();
    });

    it('caps the confidence by the number of records, whatever the model claims', async () => {
      await seed();
      const { created } = await findPatterns({
        llm: scripted(
          { title: 'Две записи', confidence: 0.95, evidence: [{ ref: 'c1' }, { ref: 'c3' }] },
          { title: 'Четыре записи', confidence: 99, evidence: [{ ref: 'c1' }, { ref: 'c3' }, { ref: 'c5' }, { ref: 'c6' }] },
          { title: 'Шесть записей', confidence: 0.95, evidence: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((ref) => ({ ref })) },
        ),
        now: NOW,
      });
      expect(created.map((pattern) => pattern.confidence)).toEqual([0.5, 0.7, 0.85]);
    });

    it('stores text as plain text, trimmed to a sane length', async () => {
      await seed();
      const html = '<img src=x onerror=alert(1)> ' + 'я'.repeat(2_000);
      const { created } = await findPatterns({ llm: scripted({ title: html, description: html, suggestion: html, evidence: [{ ref: 'c1' }, { ref: 'c3' }] }), now: NOW });
      expect(created[0].title.length).toBeLessThanOrEqual(90);
      expect(created[0].description.length).toBeLessThanOrEqual(400);
      expect(created[0].title).toContain('<img');
    });

    it('treats two restatements in one answer as one pattern', async () => {
      await seed();
      const { created, updated } = await findPatterns({
        llm: scripted(
          { title: 'Откладывает повышение цены', evidence: [{ ref: 'c1' }, { ref: 'c3' }] },
          { title: 'Откладывает повышение цены!', evidence: [{ ref: 'c3' }, { ref: 'c5' }] },
        ),
        now: NOW,
      });
      expect(created).toHaveLength(1);
      expect(updated).toEqual([]);
      expect(created[0].occurrences).toBe(3);
    });
  });
});

describe('mergeConfidence', () => {
  it('never lowers confidence and never reaches certainty', () => {
    expect(mergeConfidence(0.8, 0.4, 0)).toBe(0.8);
    expect(mergeConfidence(0.4, 0.6, 2)).toBeCloseTo(0.66);
    expect(mergeConfidence(0.89, 0.89, 5)).toBe(0.9);
  });
});
