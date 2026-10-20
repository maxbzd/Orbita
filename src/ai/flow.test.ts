import { beforeEach, describe, expect, it } from 'vitest';
import { capturesRepo, db, itemsRepo, peopleRepo, usageRepo, wipeAll } from '../db';
import { defaultSettings } from '../db/settings';
import { SearchIndex, buildIndex } from '../search';
import { ask, buildContextPack, createLlmProvider, generateReview, parsePastedChat, importConversations, processCapture } from './index';

/** The whole loop on the deterministic providers: record → objects → review → context for another AI → question. */

const NOW = new Date('2026-10-10T12:00:00Z');
const settings = { ...defaultSettings(), autoAccept: { enabled: true, minConfidence: 0.7 } };

beforeEach(wipeAll);

describe('from a record to an answer', () => {
  it('keeps one consistent picture of the author\'s life across every feature', async () => {
    await peopleRepo.create({ name: 'Борис', role: 'teammate' });
    const llm = createLlmProvider(settings, { mock: true });
    const first = await capturesRepo.create({ kind: 'voice', day: '2026-10-07', createdAt: '2026-10-07T09:00:00Z', text: 'Решил поднять цену на тестовое. Обещал Маше прислать план занятий до пятницы.' });
    const second = await capturesRepo.create({ kind: 'text', day: '2026-10-08', createdAt: '2026-10-08T09:00:00Z', text: 'Идея: сделать мини-группу по KPI. Борис должен мне прислать отчёт до понедельника.' });
    const chat = parsePastedChat('Я: Стоит ли делать рассылку родителям?\nChatGPT: Да, раз в неделю.\nЯ: Хорошо, решил запустить рассылку.');
    const [imported] = (await importConversations([chat], { now: new Date('2026-10-08T20:00:00Z') })).created;

    for (const capture of [first, second, imported]) await processCapture(capture.id, { llm, settings, now: NOW });

    // Recorded, accepted, tied to people.
    expect((await capturesRepo.get(first.id))?.status).toBe('done');
    expect((await itemsRepo.list({ kind: 'commitment', status: 'active' })).map((item) => item.title)).toHaveLength(2);
    const [masha] = await peopleRepo.findByName('Маше');
    expect(masha.entity.mentionCount).toBe(1);
    expect(imported.kind).toBe('ai_chat');
    expect((await itemsRepo.listByCapture(imported.id)).some((item) => item.kind === 'decision')).toBe(true);

    // Review of the week sees the promises, the new objects and the days.
    const { review, digest } = await generateReview('week', '2026-10-07', { llm, now: NOW });
    expect(review.generatedBy).toBe('ai');
    expect(digest.stats).toMatchObject({ captures: 3, openIOwe: 1, openOwedToMe: 1 });
    expect(digest.overdue.map((entry) => entry.title)).toEqual([expect.stringContaining('Маше')]);

    // The pack for another AI contains the same facts, with the names masked.
    const pack = await buildContextPack({ now: NOW, privacy: 'anonymous', sections: ['commitments', 'people', 'recent'] });
    expect(pack.markdown).toContain('Человек');
    expect(pack.markdown).not.toMatch(/Маш|Игор/);
    expect(pack.markdown).toContain('просрочено');

    // The question is answered from the same data, with links back to it.
    const index = new SearchIndex();
    await buildIndex(db, index);
    const answer = await ask('Что я обещал?', { llm, search: (query, options) => index.search(query, { ...options, now: NOW }), now: NOW });
    expect(answer.citations.length).toBeGreaterThanOrEqual(2);
    expect(answer.citations.every((citation) => citation.kind === 'item')).toBe(true);

    // Every model call was counted, once.
    const purposes = (await usageRepo.listRange('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z')).map((row) => row.purpose).sort();
    expect(purposes).toEqual(['ask', 'extract', 'extract', 'extract', 'review']);
  });
});
