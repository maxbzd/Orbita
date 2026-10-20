import { beforeEach, describe, expect, it } from 'vitest';
import { wipeAll } from './maintenance';
import { NotFoundError } from './internal';
import { audioRepo, capturesRepo, checkinsRepo, itemsRepo, linksRepo, peopleRepo } from './repos';
import { db } from './schema';

beforeEach(wipeAll);

describe('create', () => {
  it('fills in the local day, empty lists and a status from the text', async () => {
    const typed = await capturesRepo.create({ kind: 'text', text: 'Сегодня думал про цены', createdAt: '2026-10-07T09:00:00.000Z' });
    expect(typed).toMatchObject({ projectIds: [], personIds: [], tags: [], status: 'transcribed', updatedAt: typed.createdAt });
    expect(typed.day).toMatch(/^2026-10-0[78]$/);

    const voice = await capturesRepo.create({ kind: 'voice', text: '   ' });
    expect(voice.status).toBe('raw');
    expect(await capturesRepo.get(voice.id)).toEqual(voice);
  });

  it('keeps an explicit day, even if it differs from the creation instant', async () => {
    const capture = await capturesRepo.create({ kind: 'text', text: 'x', day: '2026-01-02', createdAt: '2026-10-07T09:00:00.000Z' });
    expect(capture.day).toBe('2026-01-02');
  });
});

describe('update and status', () => {
  it('bumps updatedAt, protects id and createdAt, and removes a key set to undefined', async () => {
    const capture = await capturesRepo.create({ kind: 'text', text: 'a', title: 'Заголовок', createdAt: '2020-01-01T00:00:00.000Z' });
    const updated = await capturesRepo.update(capture.id, { title: undefined, text: 'b', id: 'hacked', createdAt: '2000-01-01T00:00:00.000Z' } as never);
    expect(updated.id).toBe(capture.id);
    expect(updated.createdAt).toBe(capture.createdAt);
    expect(updated.text).toBe('b');
    expect('title' in updated).toBe(false);
    expect(updated.updatedAt > capture.updatedAt).toBe(true);
  });

  it('throws NotFoundError with a Russian message for an unknown id', async () => {
    await expect(capturesRepo.update('nope', { text: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    await expect(capturesRepo.update('nope', { text: 'x' })).rejects.toThrow('Запись не найдена');
  });

  it('records the error of a failed capture for retry and clears it afterwards', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', text: 'текст' });
    const failed = await capturesRepo.markFailed(capture.id, 'Нет ключа ИИ');
    expect(failed).toMatchObject({ status: 'failed', error: 'Нет ключа ИИ' });

    const retried = await capturesRepo.setStatus(capture.id, 'extracting');
    expect(retried.status).toBe('extracting');
    expect('error' in retried).toBe(false);

    const reviewed = await capturesRepo.setStatus(capture.id, 'review');
    expect(reviewed.processedAt).toBeDefined();
  });
});

describe('queries', () => {
  it('lists the inbox: unfinished statuses only, newest first, without trashed captures', async () => {
    const old = await capturesRepo.create({ kind: 'text', text: 'a', status: 'review', createdAt: '2026-10-01T10:00:00.000Z' });
    const fresh = await capturesRepo.create({ kind: 'text', text: 'b', status: 'failed', createdAt: '2026-10-05T10:00:00.000Z' });
    await capturesRepo.create({ kind: 'text', text: 'c', status: 'done' });
    await capturesRepo.create({ kind: 'text', text: 'd', status: 'skipped' });
    const trashed = await capturesRepo.create({ kind: 'text', text: 'e', status: 'raw' });
    await capturesRepo.remove(trashed.id);

    expect((await capturesRepo.listInbox()).map((capture) => capture.id)).toEqual([fresh.id, old.id]);
  });

  it('groups the stream by day, newest day and newest capture first', async () => {
    const a = await capturesRepo.create({ kind: 'text', text: 'a', day: '2026-10-06', createdAt: '2026-10-06T08:00:00.000Z' });
    const b = await capturesRepo.create({ kind: 'text', text: 'b', day: '2026-10-06', createdAt: '2026-10-06T19:00:00.000Z' });
    const c = await capturesRepo.create({ kind: 'text', text: 'c', day: '2026-10-07', createdAt: '2026-10-07T08:00:00.000Z' });

    const feed = await capturesRepo.listFeed();
    expect(feed.map((group) => group.day)).toEqual(['2026-10-07', '2026-10-06']);
    expect(feed[1]?.captures.map((capture) => capture.id)).toEqual([b.id, a.id]);
    expect(feed[0]?.captures[0]?.id).toBe(c.id);
  });

  it('filters by person, tag, kind, status and day range, and honours the limit', async () => {
    const person = await peopleRepo.create({ name: 'Маша' });
    await capturesRepo.create({ kind: 'voice', text: 'a', day: '2026-10-01', personIds: [person.id], tags: ['учёба'], status: 'done' });
    await capturesRepo.create({ kind: 'text', text: 'b', day: '2026-10-05', personIds: [person.id], status: 'review' });
    await capturesRepo.create({ kind: 'text', text: 'c', day: '2026-10-09', tags: ['учёба'], status: 'done' });

    expect(await capturesRepo.list({ personId: person.id })).toHaveLength(2);
    expect(await capturesRepo.list({ tag: 'учёба' })).toHaveLength(2);
    expect(await capturesRepo.list({ kind: 'voice' })).toHaveLength(1);
    expect(await capturesRepo.list({ statuses: ['review'] })).toHaveLength(1);
    expect((await capturesRepo.list({ fromDay: '2026-10-02', toDay: '2026-10-09' })).map((capture) => capture.day)).toEqual(['2026-10-09', '2026-10-05']);
    expect(await capturesRepo.list({ limit: 1 })).toHaveLength(1);
    expect(await capturesRepo.list({ fromDay: '2026-10-01', limit: 2 })).toHaveLength(2);
  });

  it('counts captures per day, skipping trashed ones', async () => {
    await capturesRepo.create({ kind: 'text', text: 'a', day: '2026-10-06' });
    await capturesRepo.create({ kind: 'text', text: 'b', day: '2026-10-06' });
    const gone = await capturesRepo.create({ kind: 'text', text: 'c', day: '2026-10-06' });
    await capturesRepo.create({ kind: 'text', text: 'd', day: '2026-10-08' });
    await capturesRepo.remove(gone.id);
    expect(await capturesRepo.countsByDay('2026-10-01', '2026-10-31')).toEqual({ '2026-10-06': 2, '2026-10-08': 1 });
  });

  it('getMany leaves out missing and trashed captures and keeps the order asked', async () => {
    const a = await capturesRepo.create({ kind: 'text', text: 'a' });
    const b = await capturesRepo.create({ kind: 'text', text: 'b' });
    const c = await capturesRepo.create({ kind: 'text', text: 'c' });
    await capturesRepo.remove(b.id);
    expect((await capturesRepo.getMany([c.id, b.id, 'missing', a.id])).map((capture) => capture.id)).toEqual([c.id, a.id]);
  });
});

describe('invariant 4: people mention counters follow the captures', () => {
  it('counts on create, change of personIds, trash, restore and permanent delete', async () => {
    const masha = await peopleRepo.create({ name: 'Маша' });
    const petya = await peopleRepo.create({ name: 'Петя' });
    expect(masha.mentionCount).toBe(0);

    const first = await capturesRepo.create({ kind: 'text', text: 'a', personIds: [masha.id], createdAt: '2026-10-01T10:00:00.000Z' });
    const second = await capturesRepo.create({ kind: 'text', text: 'b', personIds: [masha.id, petya.id], createdAt: '2026-10-03T10:00:00.000Z' });
    expect(await peopleRepo.get(masha.id)).toMatchObject({ mentionCount: 2, lastMentionAt: second.createdAt });
    expect(await peopleRepo.get(petya.id)).toMatchObject({ mentionCount: 1, lastMentionAt: second.createdAt });

    await capturesRepo.update(second.id, { personIds: [petya.id] });
    expect(await peopleRepo.get(masha.id)).toMatchObject({ mentionCount: 1, lastMentionAt: first.createdAt });

    await capturesRepo.remove(second.id);
    expect(await peopleRepo.get(petya.id)).toMatchObject({ mentionCount: 0 });
    expect((await peopleRepo.get(petya.id))?.lastMentionAt).toBeUndefined();

    await capturesRepo.restore(second.id);
    expect((await peopleRepo.get(petya.id))?.mentionCount).toBe(1);

    await capturesRepo.destroy(first.id);
    expect(await peopleRepo.get(masha.id)).toMatchObject({ mentionCount: 0 });
  });

  it('ignores manual edits of the counters', async () => {
    const person = await peopleRepo.create({ name: 'Маша' });
    await peopleRepo.update(person.id, { mentionCount: 99, lastMentionAt: '2030-01-01T00:00:00.000Z' } as never);
    await capturesRepo.create({ kind: 'text', text: 'a', personIds: [person.id] });
    expect((await peopleRepo.get(person.id))?.mentionCount).toBe(1);
  });

  it('counts the mentions of a person created after the captures (import, demo)', async () => {
    await capturesRepo.create({ kind: 'text', text: 'a', personIds: ['p-late'] });
    const person = await peopleRepo.create({ id: 'p-late', name: 'Поздний' });
    expect(person.mentionCount).toBe(1);
  });
});

describe('invariant 3: deleting a capture keeps the accepted objects', () => {
  it('moving to the trash dismisses proposals and leaves accepted items untouched', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', text: 'Решил поднять цену', status: 'review' });
    const accepted = await itemsRepo.create({ kind: 'lesson', title: 'Цена важнее скидок', captureId: capture.id });
    const proposed = await itemsRepo.create({ kind: 'task', title: 'Посчитать', captureId: capture.id, status: 'proposed' });

    await capturesRepo.remove(capture.id);

    expect(await itemsRepo.get(accepted.id)).toMatchObject({ status: 'active', captureId: capture.id });
    expect((await itemsRepo.get(proposed.id))?.status).toBe('dismissed');
    expect((await capturesRepo.get(capture.id))?.deletedAt).toBeDefined();
    expect(await capturesRepo.listByDay(capture.day)).toEqual([]);
  });

  it('restoring brings back the proposals the trash dismissed, but not ones the user dismissed earlier', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', text: 'Решил поднять цену', status: 'review' });
    const earlier = await itemsRepo.create({ kind: 'task', title: 'Не надо', captureId: capture.id, status: 'dismissed' });
    const proposed = await itemsRepo.create({ kind: 'task', title: 'Посчитать', captureId: capture.id, status: 'proposed' });

    await capturesRepo.remove(capture.id);
    expect((await itemsRepo.get(proposed.id))?.status).toBe('dismissed');
    await capturesRepo.restore(capture.id);

    expect((await itemsRepo.get(proposed.id))?.status).toBe('proposed');
    expect((await itemsRepo.get(earlier.id))?.status).toBe('dismissed');
  });

  it('destroying detaches accepted items (sourceDeleted) and removes everything that hung on the capture', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', text: 'текст', status: 'done' });
    const accepted = await itemsRepo.create({ kind: 'idea', title: 'Идея', captureId: capture.id });
    const dismissed = await itemsRepo.create({ kind: 'task', title: 'Не надо', captureId: capture.id, status: 'dismissed' });
    const checkIn = await checkinsRepo.create({ valence: 0.2, energy: 0.5, captureId: capture.id });
    await audioRepo.save(capture.id, new Blob(['audio'], { type: 'audio/webm' }));
    await audioRepo.appendChunk({ captureId: capture.id, seq: 0, data: new Blob(['c']) });
    await linksRepo.create({ from: capture.id, to: accepted.id, kind: 'related' });

    await capturesRepo.destroy(capture.id);

    const kept = await itemsRepo.get(accepted.id);
    expect(kept).toMatchObject({ sourceDeleted: true, status: 'active' });
    expect(kept && 'captureId' in kept).toBe(false);
    expect(await itemsRepo.get(dismissed.id)).toBeUndefined();
    expect(await capturesRepo.get(capture.id)).toBeUndefined();
    expect(await audioRepo.getForCapture(capture.id)).toBeUndefined();
    expect(await audioRepo.listChunks(capture.id)).toEqual([]);
    expect(await linksRepo.listFor(capture.id)).toEqual([]);
    const survivor = await checkinsRepo.get(checkIn.id);
    expect(survivor && 'captureId' in survivor).toBe(false);
    expect(await db.tombstones.get(capture.id)).toMatchObject({ table: 'captures' });
  });
});
