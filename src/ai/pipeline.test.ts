import { beforeEach, describe, expect, it, vi } from 'vitest';
import { audioRepo, capturesRepo, checkinsRepo, itemsRepo, peopleRepo, profileRepo, usageRepo, wipeAll } from '../db';
import { defaultSettings } from '../db/settings';
import { NotFoundError } from '../db';
import type { Settings } from '../domain/types';
import { AbortedError, BadResponseError, NoKeyError } from './errors';
import { MAX_PARTS, PART_CHARS } from './parts';
import { processCapture } from './pipeline';
import { createMockLlmProvider } from './providers/mock';
import { createMockStt } from './providers/stt/mock';
import type { LlmProvider } from './providers/types';
import { recordLlmUsage } from './usage';

const DAY = '2026-10-07';
const NOW = new Date('2026-10-07T12:00:00Z');

const TEXT =
  'Решил проводить тестовые только по вторникам, потому что в пятницу все уставшие. ' +
  'Обещал Маше прислать план занятий до пятницы. ' +
  'Идея: сделать мини-группу по KPI. ' +
  'Думаю, что Борис придёт на тестовое, вероятность 70%. ' +
  'Сегодня устал, нет сил.';

const llm = (): LlmProvider => createMockLlmProvider({ onUsage: recordLlmUsage });

const failing = (error: Error): LlmProvider => ({
  id: 'mock',
  structured: () => Promise.reject(error),
  chat: () => Promise.reject(error),
  test: () => Promise.resolve({ ok: true, message: '' }),
});

const withAutoAccept = (minConfidence: number): Settings => ({ ...defaultSettings(), autoAccept: { enabled: true, minConfidence } });

async function newCapture(text = TEXT) {
  return capturesRepo.create({ kind: 'text', text, day: DAY, createdAt: '2026-10-07T09:00:00Z' });
}

beforeEach(wipeAll);

describe('processCapture', () => {
  it('turns a record into proposed objects with located quotes and sends it to review', async () => {
    const capture = await newCapture();
    const result = await processCapture(capture.id, { llm: llm(), now: NOW });

    expect(result.outcome).toBe('review');
    expect(result.capture.status).toBe('review');
    expect(result.capture.processedAt).toBeDefined();
    expect(result.capture.title).toBeTruthy();
    expect(result.capture.summary).toBeTruthy();

    const kinds = result.items.map((item) => item.kind);
    expect(kinds).toEqual(expect.arrayContaining(['decision', 'commitment', 'idea', 'prediction']));
    expect(result.items.every((item) => item.status === 'proposed' && item.captureId === capture.id)).toBe(true);

    for (const item of result.items) {
      // Invariant 2: evidence points into the record.
      expect(item.quote).toBeTruthy();
      expect(TEXT.slice(item.quoteStart, (item.quoteStart ?? 0) + (item.quote?.length ?? 0))).toBe(item.quote);
    }

    const prediction = result.items.find((item) => item.kind === 'prediction');
    expect(prediction).toMatchObject({ probability: 0.7 });
    const commitment = result.items.find((item) => item.kind === 'commitment');
    expect(commitment).toMatchObject({ direction: 'i_owe' });
    expect(commitment?.dueAt?.slice(0, 10)).toBe('2026-10-09');
  });

  it('creates the people it meets and links them to the record and the objects', async () => {
    const capture = await newCapture();
    const result = await processCapture(capture.id, { llm: llm(), now: NOW });

    const names = result.newPeople.map((person) => person.name).sort();
    expect(names).toEqual(['Борис', 'Маша']);
    const masha = result.newPeople.find((person) => person.name === 'Маша');
    expect(result.capture.personIds).toContain(masha?.id);
    expect(result.items.find((item) => item.kind === 'commitment')?.personIds).toContain(masha?.id);
    // Invariant 4: counters come from the captures that mention the person.
    expect((await peopleRepo.get(masha?.id ?? ''))?.mentionCount).toBe(1);
  });

  it('links to an existing person instead of creating a duplicate', async () => {
    const masha = await peopleRepo.create({ name: 'Маша', role: 'student' });
    const capture = await newCapture('Обещал Маше прислать план занятий до пятницы.');
    const result = await processCapture(capture.id, { llm: llm(), now: NOW });

    expect(result.newPeople).toEqual([]);
    expect(result.capture.personIds).toEqual([masha.id]);
    expect(await peopleRepo.list()).toHaveLength(1);
  });

  it('does not link a real record to a person from the demo set', async () => {
    const demo = await peopleRepo.create({ name: 'Маша', role: 'student', isDemo: true });
    const capture = await newCapture('Обещал Маше прислать план занятий до пятницы.');
    const result = await processCapture(capture.id, { llm: llm(), now: NOW });

    expect(result.capture.personIds).not.toContain(demo.id);
    expect(result.newPeople).toHaveLength(1);
  });

  it('does not take the author for a person it met', async () => {
    await profileRepo.save({ name: 'Фёдор' });
    const capture = await newCapture('Фёдор решил поднять цену. Обещал Маше прислать план до пятницы.');
    const result = await processCapture(capture.id, { llm: llm(), now: NOW });
    expect(result.newPeople.map((person) => person.name)).toEqual(['Маша']);
  });

  it('suggests the state when the author talks about it, as a check-in the user can confirm', async () => {
    const capture = await newCapture();
    const result = await processCapture(capture.id, { llm: llm(), now: NOW });

    expect(result.mood).toMatchObject({ origin: 'ai_suggested', captureId: capture.id, day: DAY });
    expect(result.mood?.valence).toBeLessThan(0);
    expect(await checkinsRepo.listByDay(DAY)).toHaveLength(1);
  });

  it('writes the tokens of the run to the usage table once per request', async () => {
    const capture = await newCapture();
    const result = await processCapture(capture.id, { llm: llm(), now: NOW });

    expect(result.usage.requests).toBe(1);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    const rows = await usageRepo.listRange('2000-01-01T00:00:00Z', '2100-01-01T00:00:00Z');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: 'extract', inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens });
  });

  it('shows the model the known people, the open objects and the day of the record', async () => {
    await peopleRepo.create({ name: 'Борис', role: 'teammate' });
    const earlier = await itemsRepo.create({ kind: 'task', title: 'Позвонить в банк', status: 'active' });
    const provider = llm();
    const spy = vi.spyOn(provider, 'structured');
    const capture = await newCapture();
    await processCapture(capture.id, { llm: provider, now: NOW });

    const request = spy.mock.calls[0][0];
    expect(request.purpose).toBe('extract');
    expect(request.tier).toBe('fast');
    expect(request.user).toContain('Запись сделана: 2026-10-07');
    expect(request.user).toContain('- Борис — teammate');
    expect(request.user).toContain(`o1 [задача] ${earlier.title}`);
    expect(request.user).toContain(`<record>\n${TEXT}\n</record>`);
  });

  describe('repeated runs', () => {
    it('replace the proposals instead of piling them up', async () => {
      const capture = await newCapture();
      const first = await processCapture(capture.id, { llm: llm(), now: NOW });
      const second = await processCapture(capture.id, { llm: llm(), now: NOW });

      expect(second.items.map((item) => item.title)).toEqual(first.items.map((item) => item.title));
      expect(await itemsRepo.listByCapture(capture.id)).toHaveLength(first.items.length);
      expect(await peopleRepo.list()).toHaveLength(2);
      expect(await checkinsRepo.listByDay(DAY)).toHaveLength(1);
    });

    it('leave accepted and dismissed objects alone and do not propose them again', async () => {
      const capture = await newCapture();
      const first = await processCapture(capture.id, { llm: llm(), now: NOW });
      const decision = first.items.find((item) => item.kind === 'decision');
      const idea = first.items.find((item) => item.kind === 'idea');
      await itemsRepo.accept(decision?.id ?? '', { title: 'Пробные только по вторникам' });
      await itemsRepo.dismiss(idea?.id ?? '');

      const second = await processCapture(capture.id, { llm: llm(), now: NOW });

      const all = await itemsRepo.listByCapture(capture.id);
      expect(all.find((item) => item.id === decision?.id)).toMatchObject({ status: 'active', title: 'Пробные только по вторникам' });
      expect(all.find((item) => item.id === idea?.id)?.status).toBe('dismissed');
      expect(second.items.map((item) => item.kind)).not.toContain('decision');
      expect(second.items.map((item) => item.kind)).not.toContain('idea');
      expect(all.filter((item) => item.kind === 'decision')).toHaveLength(1);
    });

    it('keep a title the author wrote but refresh the summary', async () => {
      const capture = await newCapture();
      await capturesRepo.update(capture.id, { title: 'Мой заголовок', summary: 'Старое резюме' });
      const result = await processCapture(capture.id, { llm: llm(), now: NOW });
      expect(result.capture.title).toBe('Мой заголовок');
      expect(result.capture.summary).not.toBe('Старое резюме');
    });

    it('do not take the people the author linked by hand away', async () => {
      const friend = await peopleRepo.create({ name: 'Пётр' });
      const capture = await newCapture();
      await capturesRepo.update(capture.id, { personIds: [friend.id] });
      const result = await processCapture(capture.id, { llm: llm(), now: NOW });
      expect(result.capture.personIds).toContain(friend.id);
      expect(result.capture.personIds.length).toBeGreaterThan(1);
    });

    it('join a concurrent call instead of starting a second request', async () => {
      const provider = llm();
      const spy = vi.spyOn(provider, 'structured');
      const capture = await newCapture();
      const [a, b] = await Promise.all([processCapture(capture.id, { llm: provider, now: NOW }), processCapture(capture.id, { llm: provider, now: NOW })]);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(a).toBe(b);
    });
  });

  describe('auto-accept', () => {
    it('accepts the confident objects and settles the capture to done', async () => {
      const capture = await newCapture();
      const result = await processCapture(capture.id, { llm: llm(), settings: withAutoAccept(0.7), now: NOW });

      expect(result.autoAccepted).toBe(result.items.length);
      expect(result.items.every((item) => item.status === 'active')).toBe(true);
      expect(result.outcome).toBe('done');
      expect(result.capture.status).toBe('done');
    });

    it('does not accept below the threshold', async () => {
      const capture = await newCapture();
      const result = await processCapture(capture.id, { llm: llm(), settings: withAutoAccept(0.95), now: NOW });
      expect(result.autoAccepted).toBe(0);
      expect(result.outcome).toBe('review');
      expect(result.items.every((item) => item.status === 'proposed')).toBe(true);
    });

    it('leaves a suspected duplicate for the user', async () => {
      await itemsRepo.create({ kind: 'idea', title: 'Сделать мини-группу по KPI', status: 'active', stage: 'spark', relatedIds: [] });
      const capture = await newCapture();
      const result = await processCapture(capture.id, { llm: llm(), settings: withAutoAccept(0.7), now: NOW });

      const idea = result.items.find((item) => item.kind === 'idea');
      expect(idea?.duplicateOf).toBeDefined();
      expect(idea?.status).toBe('proposed');
      expect(result.outcome).toBe('review');
      expect(result.autoAccepted).toBe(result.items.length - 1);
    });
  });

  it('marks a record with nothing in it as done without objects', async () => {
    const capture = await newCapture('Просто гулял по парку, было красиво.');
    const result = await processCapture(capture.id, { llm: llm(), now: NOW });
    expect(result.outcome).toBe('done');
    expect(result.items).toEqual([]);
    expect(result.capture.status).toBe('done');
  });

  describe('when something goes wrong', () => {
    it('saves a Russian message on the capture and lets the next run succeed', async () => {
      const capture = await newCapture();
      await expect(processCapture(capture.id, { llm: failing(new BadResponseError('нет JSON')), now: NOW })).rejects.toBeInstanceOf(BadResponseError);

      const failed = await capturesRepo.get(capture.id);
      expect(failed?.status).toBe('failed');
      expect(failed?.error).toMatch(/[а-яё]/i);

      const retry = await processCapture(capture.id, { llm: llm(), now: NOW });
      expect(retry.capture.status).toBe('review');
      expect(retry.capture.error).toBeUndefined();
    });

    it('keeps the record waiting when there is no API key', async () => {
      const capture = await newCapture();
      await expect(processCapture(capture.id, { llm: failing(new NoKeyError()), now: NOW })).rejects.toBeInstanceOf(NoKeyError);
      const waiting = await capturesRepo.get(capture.id);
      expect(waiting?.status).toBe('transcribed');
      expect(waiting?.error).toBeUndefined();
    });

    it('puts the record back when the user cancels', async () => {
      const capture = await newCapture();
      await expect(processCapture(capture.id, { llm: failing(new AbortedError()), now: NOW })).rejects.toBeInstanceOf(AbortedError);
      expect((await capturesRepo.get(capture.id))?.status).toBe('transcribed');
    });

    it('puts a reviewed record back to where it was, accepted objects untouched', async () => {
      const capture = await newCapture();
      const first = await processCapture(capture.id, { llm: llm(), settings: withAutoAccept(0.7), now: NOW });
      await expect(processCapture(capture.id, { llm: failing(new AbortedError()), now: NOW })).rejects.toBeInstanceOf(AbortedError);
      expect((await capturesRepo.get(capture.id))?.status).toBe('done');
      expect((await itemsRepo.listByCapture(capture.id)).map((item) => item.status)).toEqual(first.items.map(() => 'active'));
    });

    it('rejects an unknown or trashed capture', async () => {
      await expect(processCapture('missing', { llm: llm() })).rejects.toBeInstanceOf(NotFoundError);
      const capture = await newCapture();
      await capturesRepo.remove(capture.id);
      await expect(processCapture(capture.id, { llm: llm() })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('records without text', () => {
    const audio = () => new Blob(['sound'], { type: 'audio/webm' });

    it('recognizes the recording first when a recognizer is given', async () => {
      const capture = await capturesRepo.create({ kind: 'voice', day: DAY, durationSec: 30 });
      await audioRepo.save(capture.id, audio());
      const result = await processCapture(capture.id, { llm: llm(), stt: createMockStt(), now: NOW });

      expect(result.capture.rawText).toBeTruthy();
      expect(result.capture.text).toBe(result.capture.rawText);
      expect(result.outcome).toBe('review');
      expect(result.items.length).toBeGreaterThan(0);
    });

    it('keeps the recording by default and drops it only once the text is processed when keepAudio is off', async () => {
      const kept = await capturesRepo.create({ kind: 'voice', day: DAY, durationSec: 30 });
      await audioRepo.save(kept.id, audio());
      await processCapture(kept.id, { llm: llm(), stt: createMockStt(), now: NOW });
      expect(await audioRepo.getForCapture(kept.id)).toBeDefined();

      const settings = { ...defaultSettings(), capture: { ...defaultSettings().capture, keepAudio: false } };
      const dropped = await capturesRepo.create({ kind: 'voice', day: DAY, durationSec: 30 });
      await audioRepo.save(dropped.id, audio());
      const result = await processCapture(dropped.id, { llm: llm(), stt: createMockStt(), settings, now: NOW });
      expect(result.outcome).toBe('review');
      expect(result.capture.text).toBeTruthy();
      expect(await audioRepo.getForCapture(dropped.id)).toBeUndefined();
      expect((await capturesRepo.get(dropped.id))?.audioId).toBeUndefined();
    });

    it('leaves a recording alone when there is no recognizer', async () => {
      const capture = await capturesRepo.create({ kind: 'voice', day: DAY });
      await audioRepo.save(capture.id, audio());
      const result = await processCapture(capture.id, { llm: llm(), now: NOW });
      expect(result.outcome).toBe('waiting');
      expect((await capturesRepo.get(capture.id))?.status).toBe('raw');
    });

    it('skips silence and an empty record', async () => {
      const silent = await capturesRepo.create({ kind: 'voice', day: DAY });
      await audioRepo.save(silent.id, audio());
      expect((await processCapture(silent.id, { llm: llm(), stt: createMockStt({ text: '   ' }), now: NOW })).outcome).toBe('skipped');

      const empty = await capturesRepo.create({ kind: 'text', day: DAY });
      const result = await processCapture(empty.id, { llm: llm(), now: NOW });
      expect(result.outcome).toBe('skipped');
      expect(result.capture.status).toBe('skipped');
    });
  });

  describe('long records', () => {
    const sentence = 'Решил поднять цену на тестовое занятие. ';

    it('are sent in parts, labelled for the model, and merged', async () => {
      const text = sentence.repeat(Math.ceil((PART_CHARS * 2.5) / sentence.length));
      const provider = llm();
      const spy = vi.spyOn(provider, 'structured');
      const capture = await newCapture(text);
      const result = await processCapture(capture.id, { llm: provider, now: NOW });

      expect(spy).toHaveBeenCalledTimes(3);
      expect(spy.mock.calls[1][0].user).toContain('Запись (часть 2 из 3)');
      expect(result.usage.requests).toBe(3);
      expect(result.truncated).toBe(false);
      // The same decision restated in every part is proposed once.
      expect(result.items.filter((item) => item.kind === 'decision')).toHaveLength(1);
    });

    it('report a tail that was not processed', async () => {
      const text = sentence.repeat(Math.ceil((PART_CHARS * (MAX_PARTS + 2)) / sentence.length));
      const provider = llm();
      const spy = vi.spyOn(provider, 'structured');
      const capture = await newCapture(text);
      const result = await processCapture(capture.id, { llm: provider, now: NOW });
      expect(spy).toHaveBeenCalledTimes(MAX_PARTS);
      expect(result.truncated).toBe(true);
    });
  });
});
