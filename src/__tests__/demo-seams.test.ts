import { beforeEach, describe, expect, it } from 'vitest';
import { capturesRepo, db, hasDemoData, itemsRepo, peopleRepo, patternsRepo, reviewsRepo, wipeAll } from '../db';
import { defaultSettings } from '../db/settings';
import { removeDemo, seedDemo } from '../db/seed';
import { ask, buildContextPack, buildReviewDigest, createLlmProvider, findPatterns, generateReview, processCapture } from '../ai';
import { addDays, startOfWeek } from '../domain/dates';
import { estimateTokens } from '../domain/tokens';
import { SearchIndex, buildIndex } from '../search';

/**
 * The demo set is the biggest realistic data the layers will meet before a user has their own: 51 records,
 * 156 objects, 13 people. Everything the AI layer and the search read has to cope with it.
 */

const NOW = new Date('2026-10-08T12:00:00Z');
const llm = createLlmProvider(defaultSettings(), { mock: true });

beforeEach(async () => {
  await wipeAll();
  await seedDemo({ now: NOW });
});

describe('the demo set through the AI layer', () => {
  it('builds a context pack that fits any budget and hides the people when asked to', async () => {
    const full = await buildContextPack({ now: NOW, windowDays: 60, maxTokens: 200_000 });
    expect(full.trimmed).toBe(false);
    expect(full.markdown).toContain('## Профиль');
    expect(full.markdown).toContain('Открытые обязательства');
    expect(full.sections.every((section) => section.included === section.total)).toBe(true);

    for (const maxTokens of [600, 2_000, 5_000]) {
      const small = await buildContextPack({ now: NOW, windowDays: 60, maxTokens });
      expect(small.trimmed).toBe(true);
      expect(small.tokens.markdown).toBeLessThanOrEqual(maxTokens);
      expect(estimateTokens(small.markdown)).toBeLessThanOrEqual(maxTokens);
      expect(small.markdown).toContain('## Профиль');
    }

    // The names of the people in the database do not survive in either form of the pack.
    const names = (await peopleRepo.list({ includeArchived: true })).filter((person) => /\s/.test(person.name) || person.name.length > 4);
    expect(names.length).toBeGreaterThan(8);
    for (const privacy of ['anonymous', 'initials'] as const) {
      const pack = await buildContextPack({ now: NOW, windowDays: 60, maxTokens: 200_000, privacy });
      const text = `${pack.markdown}\n${pack.json}`;
      for (const person of names) {
        for (const part of person.name.split(/\s+/).filter((word) => word.length >= 4)) {
          const prefix = part.toLowerCase().replace(/ё/g, 'е').slice(0, Math.max(4, part.length - 1));
          const found = new RegExp(`(?<![\\p{L}])${prefix.replace(/е/g, '[её]')}`, 'iu').exec(text);
          expect(found, `«${part}» in the ${privacy} pack: …${found ? text.slice(Math.max(0, found.index - 30), found.index + 30) : ''}…`).toBeNull();
        }
      }
    }
  });

  it('reviews a week from the same records the database holds, rules first', async () => {
    const week = startOfWeek(addDays('2026-10-08', -7));
    const digest = await buildReviewDigest('week', week, NOW);
    const inWeek = (await capturesRepo.list({ fromDay: digest.startDay, toDay: digest.endDay })).length;
    expect(digest.stats.captures).toBe(inWeek);
    expect(inWeek).toBeGreaterThan(0);

    const before = await reviewsRepo.list();
    const { review } = await generateReview('week', week, { llm, now: NOW, save: false });
    expect(review.generatedBy).toBe('ai');
    expect(review.sections.map((section) => section.kind)).toEqual(expect.arrayContaining(['stats', 'wins', 'calibration']));
    expect(await reviewsRepo.list()).toEqual(before);

    // Rules work without a model, on the same data.
    const offline = await generateReview('week', week, { now: NOW, save: false });
    expect(offline.review.generatedBy).toBe('rules');
    expect(offline.review.sections.find((section) => section.kind === 'stats')?.body).toBeTruthy();
  });

  it('answers a question from the records, with links that lead to records that exist', async () => {
    const index = new SearchIndex();
    expect(await buildIndex(db, index)).toBeGreaterThan(150);

    const answer = await ask('Что я обещал?', { llm, search: (query, options) => index.search(query, { ...options, now: NOW }), now: NOW });
    expect(answer.citations.length).toBeGreaterThan(0);
    for (const citation of answer.citations) {
      const record = citation.kind === 'item' ? await itemsRepo.get(citation.id) : await capturesRepo.get(citation.id);
      expect(record, `citation ${citation.kind} ${citation.id}`).toBeDefined();
    }
    // The text carries no code the materials did not have (known codes stay: they become the links).
    const known = new Set(answer.materials.sources.map((source) => source.code));
    for (const [, code] of answer.text.matchAll(/\[([cipt]\d+)\]/g)) expect(known.has(code), `code ${code}`).toBe(true);
    expect(answer.unknownCodes).toEqual([]);
  });

  it('finds the mentor by a name form that appears in the records, and narrows by person', async () => {
    const index = new SearchIndex();
    await buildIndex(db, index);
    const [mentor] = (await peopleRepo.findByName('Прие')).map((match) => match.entity);
    expect(mentor?.name).toBe('Прия Раман');

    const hits = index.search('Прие', { kinds: ['capture'], now: NOW });
    expect(hits.length).toBeGreaterThan(2);
    const narrowed = index.search('цена', { filters: { personId: mentor.id }, now: NOW });
    expect(narrowed.length).toBeGreaterThan(0);
    for (const hit of narrowed) {
      if (hit.kind === 'capture') expect((await capturesRepo.get(hit.id))?.personIds).toContain(mentor.id);
    }
  });

  it('finds candidate patterns in the demo months without losing the known ones', async () => {
    const known = (await patternsRepo.list()).map((pattern) => pattern.id);
    const result = await findPatterns({ llm, now: NOW });
    expect(result.reason).toBeUndefined();
    expect(result.examined).toBeGreaterThan(20);
    const after = (await patternsRepo.list()).map((pattern) => pattern.id);
    expect(after).toEqual(expect.arrayContaining(known));
  });

  it('re-runs extraction on a demo record waiting for review, and leaves nothing behind when the demo is removed', async () => {
    const [waiting] = await capturesRepo.list({ statuses: ['review'] });
    expect(waiting).toBeDefined();
    const result = await processCapture(waiting.id, { llm, now: NOW });
    expect(result.outcome).toBe('review');
    expect(result.items.length).toBeGreaterThan(0);

    expect(await hasDemoData()).toBe(true);
    await removeDemo();
    expect(await hasDemoData()).toBe(false);
    expect(await db.captures.count()).toBe(0);
    expect(await db.items.count()).toBe(0);
    expect(await db.people.count()).toBe(0);
    expect(await db.links.count()).toBe(0);
    expect(await db.tombstones.count()).toBe(0);
  });
});
