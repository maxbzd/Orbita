import { beforeEach, describe, expect, it } from 'vitest';
import { capturesRepo, db, itemsRepo, peopleRepo, profileRepo, usageRepo, wipeAll } from '../db';
import { defaultSettings } from '../db/settings';
import { BadResponseError, buildContextPack, createLlmProvider, processCapture } from '../ai';
import { jsonReply, scriptedFetch, testHttp } from '../ai/testing';
import type { LlmProvider } from '../ai';
import type { Capture, Item, Settings } from '../domain/types';
import { SearchIndex, buildIndex, startIndexSync } from '../search';

/**
 * The seams between layers, end to end: a record → the model (deterministic mock, or a real provider on a
 * scripted network) → proposed objects with quotes → the user's decision → derived counters → the context pack
 * for another AI → search. Nothing here is mocked below the model: the real repositories, the real IndexedDB
 * (fake-indexeddb), the real index.
 */

const NOW = new Date('2026-10-09T12:00:00Z');
const FIRST_DAY = '2026-10-07';
const SECOND_DAY = '2026-10-08';
const FIRST_AT = '2026-10-07T09:00:00.000Z';
const SECOND_AT = '2026-10-08T09:30:00.000Z';

const FIRST_TEXT =
  'Решил проводить тестовые только по вторникам, потому что в пятницу все уставшие. ' +
  'Обещал Маше прислать план занятий до пятницы. ' +
  'Идея: сделать мини-группу по KPI. ' +
  'Думаю, что Борис придёт на тестовое, вероятность 70%.';
const SECOND_TEXT = 'Борис должен мне прислать отчёт по урокам до понедельника. Обещал Маше показать расписание на ноябрь.';

const mockLlm = (settings: Settings = defaultSettings()): LlmProvider => createLlmProvider(settings, { mock: true });

const quoteOf = (capture: Pick<Capture, 'text'>, item: Item): string | undefined =>
  item.quote === undefined || item.quoteStart === undefined ? undefined : capture.text.slice(item.quoteStart, item.quoteStart + item.quote.length);

const newCapture = (text = FIRST_TEXT) => capturesRepo.create({ kind: 'text', day: FIRST_DAY, createdAt: FIRST_AT, text });

/** Index updates run after a transaction commits, one after another: let them drain. */
const settleIndex = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));

beforeEach(wipeAll);

describe('record → objects → decision → context → search', () => {
  it('keeps one consistent picture of the author’s life across the layers', async () => {
    await profileRepo.save({
      name: 'Антон',
      about: 'Консультант по математике, веду онлайн-школу.',
      goals: 'Набрать мини-группу KPI до зимы.',
      glossary: [{ term: 'KPI', hint: 'основной государственный экзамен' }],
    });
    await peopleRepo.create({ name: 'Борис', role: 'teammate' });
    const llm = mockLlm();

    // 1. A record with text is created and processed.
    const first = await newCapture();
    expect(first.status).toBe('transcribed');
    const processed = await processCapture(first.id, { llm, now: NOW });

    // 2. Proposed objects exist, each tied to the record and to a verbatim quote that sits where it says.
    expect(processed.outcome).toBe('review');
    expect(processed.capture.status).toBe('review');
    const proposed = await itemsRepo.listProposed(first.id);
    expect(proposed.map((item) => item.kind).sort()).toEqual(['commitment', 'decision', 'idea', 'prediction']);
    expect(proposed).toHaveLength(processed.items.length);
    for (const item of proposed) {
      expect(item.status).toBe('proposed');
      expect(item.captureId).toBe(first.id);
      expect(item.quote, `quote of «${item.title}»`).toBeTruthy();
      expect(quoteOf(first, item)).toBe(item.quote);
    }

    // Nothing proposed counts as an open promise yet: not in the lists, not in the pack.
    expect(await itemsRepo.listOpenCommitments()).toEqual([]);
    const before = await buildContextPack({ now: NOW, sections: ['profile', 'commitments'] });
    expect(before.markdown).toContain('Антон');
    expect(before.markdown).not.toContain('Открытые обязательства');

    // 3. People found in the text were created or matched, and the record points at them.
    const [masha] = await peopleRepo.findByName('Маша');
    const [igor] = await peopleRepo.findByName('Борис');
    expect((await capturesRepo.get(first.id))?.personIds).toEqual(expect.arrayContaining([masha.entity.id, igor.entity.id]));

    // 4. Accepting settles the record.
    const accepted = await itemsRepo.acceptAll(first.id);
    expect(accepted.every((item) => item.status === 'active')).toBe(true);
    expect((await capturesRepo.get(first.id))?.status).toBe('done');

    // 5. A second record mentions the same people in other case forms; the counters are derived from the records.
    const second = await capturesRepo.create({ kind: 'voice', day: SECOND_DAY, createdAt: SECOND_AT, text: SECOND_TEXT });
    const secondResult = await processCapture(second.id, { llm, now: NOW });
    expect(secondResult.newPeople).toEqual([]);
    await itemsRepo.acceptAll(second.id);

    const mashaNow = await peopleRepo.get(masha.entity.id);
    const igorNow = await peopleRepo.get(igor.entity.id);
    expect(mashaNow).toMatchObject({ mentionCount: 2, lastMentionAt: SECOND_AT });
    expect(igorNow).toMatchObject({ mentionCount: 2, lastMentionAt: SECOND_AT });
    await peopleRepo.recomputeMentions();
    expect(await peopleRepo.get(masha.entity.id)).toEqual(mashaNow);
    expect(await peopleRepo.get(igor.entity.id)).toEqual(igorNow);

    // Trashing a record takes it out of the counters; the objects the user accepted stay (invariant 3).
    await capturesRepo.remove(second.id);
    expect(await peopleRepo.get(masha.entity.id)).toMatchObject({ mentionCount: 1, lastMentionAt: FIRST_AT });
    expect((await itemsRepo.listByCapture(second.id)).filter((item) => item.status === 'active').length).toBeGreaterThan(0);
    await capturesRepo.restore(second.id);
    expect((await peopleRepo.get(masha.entity.id))?.mentionCount).toBe(2);

    // 6. The pack for another AI: profile, and the open promises in both directions.
    const pack = await buildContextPack({ now: NOW, sections: ['profile', 'commitments', 'people'] });
    expect(pack.markdown).toContain('Антон');
    expect(pack.markdown).toContain('Консультант по математике');
    expect(pack.markdown).toContain('Набрать мини-группу KPI');
    expect(pack.markdown).toContain('Открытые обязательства');
    expect(pack.markdown).toContain('Я должен');
    expect(pack.markdown).toContain('Мне должны');
    expect(pack.markdown).toMatch(/план занятий/i);
    expect(pack.markdown).toMatch(/отч[её]т/i);
    expect(pack.markdown).toContain('Маша');
    expect(pack.sections.find((section) => section.id === 'commitments')).toMatchObject({ total: 3, included: 3 });
    expect(pack.data.sections.commitments).toHaveLength(3);
    expect(pack.trimmed).toBe(false);

    // A closed promise leaves the pack.
    const [owedToMe] = await itemsRepo.listOpenCommitments('owed_to_me');
    await itemsRepo.setStatus(owedToMe.id, 'done');
    const after = await buildContextPack({ now: NOW, sections: ['commitments'] });
    expect(after.markdown).not.toMatch(/отч[её]т/i);
    expect(after.markdown).toMatch(/план занятий/i);

    // 7. Search finds the record, the object and the person, also through a case ending.
    const index = new SearchIndex();
    await buildIndex(db, index);
    const byPhrase = index.search('план занятий', { now: NOW });
    expect(byPhrase.map((hit) => hit.kind)).toEqual(expect.arrayContaining(['capture', 'item']));
    expect(byPhrase.find((hit) => hit.kind === 'capture')?.id).toBe(first.id);
    expect(byPhrase.find((hit) => hit.kind === 'item')?.itemKind).toBe('commitment');
    expect(index.search('Маше', { kinds: ['person'], now: NOW }).map((hit) => hit.id)).toEqual([masha.entity.id]);
    expect(index.search('мини-группа', { kinds: ['item'], filters: { itemKind: 'idea' }, now: NOW })).toHaveLength(1);
    expect(index.search('план занятий', { filters: { personId: masha.entity.id }, now: NOW }).length).toBeGreaterThan(0);

    // A trashed record is no longer searchable.
    await capturesRepo.remove(second.id);
    await buildIndex(db, index);
    expect(index.search('расписание на ноябрь', { kinds: ['capture'], now: NOW })).toEqual([]);
  });

  it('keeps a live search index in step with processing and review', async () => {
    const index = new SearchIndex();
    const sync = startIndexSync(db, index, (error) => {
      throw error instanceof Error ? error : new Error(String(error));
    });
    try {
      const capture = await newCapture();
      await processCapture(capture.id, { llm: mockLlm(), now: NOW });
      await settleIndex();
      expect(index.search('план занятий', { kinds: ['capture'], now: NOW }).map((hit) => hit.id)).toEqual([capture.id]);
      expect(index.search('мини-группу KPI', { kinds: ['item'], now: NOW }).length).toBeGreaterThan(0);

      const [idea] = (await itemsRepo.listByCapture(capture.id)).filter((item) => item.kind === 'idea');
      await itemsRepo.dismiss(idea.id);
      await settleIndex();
      expect(index.search('мини-группу KPI', { kinds: ['item'], filters: { itemKind: 'idea' }, now: NOW })).toEqual([]);
    } finally {
      sync.stop();
    }
  });

  it('auto-accepts confident objects when the settings say so, and counts the model call once', async () => {
    const settings: Settings = { ...defaultSettings(), autoAccept: { enabled: true, minConfidence: 0.7 } };
    const capture = await newCapture();

    const result = await processCapture(capture.id, { llm: createLlmProvider(settings, { mock: true }), settings, now: NOW });

    expect(result.autoAccepted).toBeGreaterThan(0);
    expect((await itemsRepo.listByCapture(capture.id)).filter((item) => item.status === 'active')).toHaveLength(result.autoAccepted);
    const rows = await usageRepo.listRange('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z');
    expect(rows.map((row) => row.purpose)).toEqual(['extract']);
    expect(result.usage.requests).toBe(1);
    expect(rows[0]).toMatchObject({ inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
  });
});

describe('a garbage answer from the model', () => {
  const anthropicSettings = (): Settings => {
    const settings = defaultSettings();
    return { ...settings, ai: { ...settings.ai, provider: 'anthropic', anthropic: { ...settings.ai.anthropic, apiKey: 'sk-ant-test-key-123456' } } };
  };

  const message = (content: unknown[]) => ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content,
    stop_reason: 'end_turn',
    usage: { input_tokens: 300, output_tokens: 40 },
  });

  /** The real Anthropic provider, built from the settings by the factory, talking to a scripted network. */
  function providerAnswering(...replies: Response[]) {
    const { fetch, requests } = scriptedFetch(...replies);
    return { llm: createLlmProvider(anthropicSettings(), { http: testHttp(fetch) }), requests };
  }

  it('turns the record into `failed` with a readable message, keeps it intact, and allows a retry', async () => {
    const capture = await newCapture();
    const prose = jsonReply(message([{ type: 'text', text: 'Конечно! Вот что я думаю про вашу запись: <script>alert(1)</script> всё отлично.' }]));
    const { llm, requests } = providerAnswering(prose);

    await expect(processCapture(capture.id, { llm, now: NOW })).rejects.toBeInstanceOf(BadResponseError);

    // The model got exactly one chance to repair its answer.
    expect(requests).toHaveLength(2);

    const failed = await capturesRepo.get(capture.id);
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toMatch(/Модель вернула ответ/);
    expect(failed?.error).not.toMatch(/script|sk-ant|undefined|\[object/i);
    expect(failed?.text).toBe(FIRST_TEXT);
    expect(await itemsRepo.listByCapture(capture.id)).toEqual([]);
    expect((await capturesRepo.listInbox()).map((entry) => entry.id)).toContain(capture.id);

    // The retry button: the same call with a working model heals the record and clears the error.
    const retried = await processCapture(capture.id, { llm: mockLlm(), now: NOW });
    expect(retried.outcome).toBe('review');
    expect(retried.capture.status).toBe('review');
    expect(retried.capture.error).toBeUndefined();
    expect((await capturesRepo.get(capture.id))?.error).toBeUndefined();
    expect((await itemsRepo.listProposed(capture.id)).length).toBeGreaterThan(0);
  });

  it('treats valid JSON of the wrong shape the same way, without storing half an answer', async () => {
    const capture = await newCapture();
    const wrongShape = jsonReply(message([{ type: 'tool_use', id: 'tu_1', name: 'orbit_extraction', input: { items: 'много', title: 42 } }]));
    const { llm, requests } = providerAnswering(wrongShape);

    await expect(processCapture(capture.id, { llm, now: NOW })).rejects.toBeInstanceOf(BadResponseError);

    expect(requests).toHaveLength(2);
    expect((await capturesRepo.get(capture.id))?.status).toBe('failed');
    expect(await itemsRepo.listByCapture(capture.id)).toEqual([]);
    expect((await capturesRepo.get(capture.id))?.personIds).toEqual([]);
    expect(await peopleRepo.list()).toEqual([]);
  });

  it('a failed re-run after a good one keeps what the user already accepted', async () => {
    const capture = await newCapture();
    await processCapture(capture.id, { llm: mockLlm(), now: NOW });
    const [decision] = (await itemsRepo.listByCapture(capture.id)).filter((item) => item.kind === 'decision');
    await itemsRepo.accept(decision.id);

    const { llm } = providerAnswering(jsonReply(message([{ type: 'text', text: 'не JSON' }])));
    await expect(processCapture(capture.id, { llm, now: NOW })).rejects.toBeInstanceOf(BadResponseError);

    expect((await capturesRepo.get(capture.id))?.status).toBe('failed');
    expect((await itemsRepo.get(decision.id))?.status).toBe('active');
    const again = await processCapture(capture.id, { llm: mockLlm(), now: NOW });
    expect(again.capture.error).toBeUndefined();
    expect((await itemsRepo.listByCapture(capture.id)).filter((item) => item.kind === 'decision')).toHaveLength(1);
  });

  it('a missing key is not a failure: the record waits where it was', async () => {
    const capture = await newCapture();
    const keyless = createLlmProvider(defaultSettings(), { http: testHttp(scriptedFetch(jsonReply({})).fetch) });
    await expect(processCapture(capture.id, { llm: keyless, now: NOW })).rejects.toMatchObject({ code: 'no_key' });
    const waiting = await capturesRepo.get(capture.id);
    expect(waiting?.status).toBe('transcribed');
    expect(waiting?.error).toBeUndefined();
  });
});
