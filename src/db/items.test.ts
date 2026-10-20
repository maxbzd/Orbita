import { beforeEach, describe, expect, it } from 'vitest';
import { wipeAll } from './maintenance';
import { NotFoundError } from './internal';
import { capturesRepo, itemsRepo, linksRepo, peopleRepo } from './repos';
import { db } from './schema';

beforeEach(wipeAll);

const hour = (offset: number): string => new Date(Date.UTC(2026, 9, 7, 12, 0, 0) + offset * 3_600_000).toISOString();

describe('create', () => {
  it('defaults to an active item with empty lists and per-kind defaults', async () => {
    const decision = await itemsRepo.create({ kind: 'decision', title: 'Поднять цену', chosen: 'Да' });
    expect(decision).toMatchObject({ status: 'active', personIds: [], projectIds: [], tags: [], alternatives: [], reasons: [] });
    const idea = await itemsRepo.create({ kind: 'idea', title: 'Курс' });
    expect(idea).toMatchObject({ kind: 'idea', stage: 'spark', relatedIds: [] });
  });

  it('trims the title, cuts it at 120 characters and rejects an empty one', async () => {
    const long = await itemsRepo.create({ kind: 'lesson', title: `  ${'а'.repeat(200)}  ` });
    expect(long.title).toHaveLength(120);
    await expect(itemsRepo.create({ kind: 'lesson', title: '   ' })).rejects.toThrow('Заголовок объекта не может быть пустым');
  });

  it('keeps confidence inside 0..1', async () => {
    expect((await itemsRepo.create({ kind: 'fact', title: 'a', confidence: 4 })).confidence).toBe(1);
    expect((await itemsRepo.create({ kind: 'fact', title: 'b', confidence: -1 })).confidence).toBe(0);
  });
});

describe('invariant 5: predictions', () => {
  it('clamps the probability into [0.01, 0.99]', async () => {
    const sure = await itemsRepo.create({ kind: 'prediction', title: 'a', probability: 1 });
    const never = await itemsRepo.create({ kind: 'prediction', title: 'b', probability: 0 });
    expect(sure).toMatchObject({ probability: 0.99 });
    expect(never).toMatchObject({ probability: 0.01 });
    await expect(itemsRepo.create({ kind: 'prediction', title: 'c', probability: Number.NaN })).rejects.toThrow(RangeError);
  });

  it('closing sets outcome, resolvedAt and done; reopening forgets them', async () => {
    const prediction = await itemsRepo.create({ kind: 'prediction', title: 'Конверсия вырастет', probability: 0.7 });
    const resolved = await itemsRepo.resolvePrediction(prediction.id, 'true', 'Выросла до 12%');
    expect(resolved).toMatchObject({ outcome: 'true', status: 'done', resolutionNote: 'Выросла до 12%' });
    expect(resolved.resolvedAt).toBeDefined();
    expect(resolved.doneAt).toBeDefined();

    const reopened = await itemsRepo.reopen(prediction.id);
    expect(reopened.status).toBe('active');
    for (const key of ['outcome', 'resolvedAt', 'resolutionNote', 'doneAt']) expect(key in reopened).toBe(false);
  });

  it('setting the outcome through update also stamps resolvedAt, and clearing it removes the stamp', async () => {
    const prediction = await itemsRepo.create({ kind: 'prediction', title: 'x', probability: 0.5 });
    const closed = await itemsRepo.update(prediction.id, { outcome: 'false' });
    expect(closed.kind === 'prediction' && closed.resolvedAt).toBeTruthy();
    const open = await itemsRepo.update(prediction.id, { outcome: undefined });
    expect(open.kind === 'prediction' && 'resolvedAt' in open).toBe(false);
  });

  it('refuses to resolve something that is not a prediction', async () => {
    const task = await itemsRepo.create({ kind: 'task', title: 'x' });
    await expect(itemsRepo.resolvePrediction(task.id, 'true')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lists the predictions to close: open ones whose date has come, oldest first', async () => {
    const late = await itemsRepo.create({ kind: 'prediction', title: 'a', probability: 0.5, dueAt: hour(-48) });
    const recent = await itemsRepo.create({ kind: 'prediction', title: 'b', probability: 0.5, dueAt: hour(-1) });
    await itemsRepo.create({ kind: 'prediction', title: 'future', probability: 0.5, dueAt: hour(24) });
    await itemsRepo.create({ kind: 'prediction', title: 'no date', probability: 0.5 });
    const closed = await itemsRepo.create({ kind: 'prediction', title: 'closed', probability: 0.5, dueAt: hour(-5) });
    await itemsRepo.resolvePrediction(closed.id, 'false');

    expect((await itemsRepo.listPredictionsToResolve(hour(0))).map((item) => item.id)).toEqual([late.id, recent.id]);
  });

  it('keeps resolvesAt and dueAt in step', async () => {
    const byAlias = await itemsRepo.create({ kind: 'prediction', title: 'a', probability: 0.5, resolvesAt: hour(5) });
    expect(byAlias.dueAt).toBe(hour(5));
    const moved = await itemsRepo.update(byAlias.id, { dueAt: hour(9) });
    expect(moved.kind === 'prediction' && moved.resolvesAt).toBe(hour(9));
  });
});

describe('decisions', () => {
  it('records how it turned out and lists the ones due for review', async () => {
    const due = await itemsRepo.create({ kind: 'decision', title: 'Уйти с рынка', chosen: 'Остаться', reviewAt: hour(-2) });
    await itemsRepo.create({ kind: 'decision', title: 'Позже', chosen: 'x', dueAt: hour(48) });
    expect(due.dueAt).toBe(hour(-2));

    expect((await itemsRepo.listDecisionsToReview(hour(0))).map((item) => item.id)).toEqual([due.id]);

    const closed = await itemsRepo.closeDecision(due.id, { rating: 4, note: 'Правильно' });
    expect(closed).toMatchObject({ status: 'done', outcome: { rating: 4, note: 'Правильно' } });
    expect(await itemsRepo.listDecisionsToReview(hour(0))).toEqual([]);

    const reopened = await itemsRepo.reopen(due.id);
    expect('outcome' in reopened).toBe(false);
  });
});

describe('commitments', () => {
  it('lists open ones by direction, nearest deadline first, no deadline last', async () => {
    const person = await peopleRepo.create({ name: 'Анна' });
    const noDate = await itemsRepo.create({ kind: 'commitment', title: 'a', direction: 'i_owe' });
    const soon = await itemsRepo.create({ kind: 'commitment', title: 'b', direction: 'i_owe', dueAt: hour(2), counterpartyId: person.id });
    const later = await itemsRepo.create({ kind: 'commitment', title: 'c', direction: 'i_owe', dueAt: hour(30) });
    const theirs = await itemsRepo.create({ kind: 'commitment', title: 'd', direction: 'owed_to_me', dueAt: hour(1) });
    const finished = await itemsRepo.create({ kind: 'commitment', title: 'e', direction: 'i_owe' });
    await itemsRepo.setStatus(finished.id, 'done');

    expect((await itemsRepo.listOpenCommitments('i_owe')).map((item) => item.id)).toEqual([soon.id, later.id, noDate.id]);
    expect((await itemsRepo.listOpenCommitments('owed_to_me')).map((item) => item.id)).toEqual([theirs.id]);
    expect(await itemsRepo.listOpenCommitments()).toHaveLength(4);
  });

  it('changes status, stamping doneAt on done and dropping it when reopened', async () => {
    const commitment = await itemsRepo.create({ kind: 'commitment', title: 'a', direction: 'i_owe' });
    const done = await itemsRepo.setStatus(commitment.id, 'done');
    expect(done.doneAt).toBeDefined();
    const dropped = await itemsRepo.setStatus(commitment.id, 'dropped');
    expect(dropped.status).toBe('dropped');
    expect('doneAt' in dropped).toBe(false);
  });
});

describe('invariant 1: proposed items are reviewed', () => {
  async function reviewedCapture() {
    const capture = await capturesRepo.create({ kind: 'voice', text: 'текст', status: 'review' });
    const [first, second, third] = await itemsRepo.replaceProposed(capture.id, [
      { kind: 'task', title: 'Первая' },
      { kind: 'lesson', title: 'Вторая' },
      { kind: 'fact', title: 'Третья' },
    ]);
    if (!first || !second || !third) throw new Error('drafts were not stored');
    return { capture, first, second, third };
  }

  it('stores drafts as proposed, linked to the capture, in extraction order', async () => {
    const { capture, first, second, third } = await reviewedCapture();
    expect([first, second, third].every((item) => item.status === 'proposed' && item.captureId === capture.id)).toBe(true);
    expect((await itemsRepo.listProposed(capture.id)).map((item) => item.title)).toEqual(['Первая', 'Вторая', 'Третья']);
    expect(await itemsRepo.countProposed()).toBe(3);
  });

  it('accept applies edits and activates; accepting again changes nothing', async () => {
    const { first } = await reviewedCapture();
    const accepted = await itemsRepo.accept(first.id, { title: 'Исправленная' });
    expect(accepted).toMatchObject({ status: 'active', title: 'Исправленная' });
    const again = await itemsRepo.accept(first.id, { title: 'Другая' });
    expect(again.title).toBe('Исправленная');
  });

  it('moves the capture to done as soon as nothing is left to decide', async () => {
    const { capture, first, second, third } = await reviewedCapture();
    await itemsRepo.accept(first.id);
    await itemsRepo.dismiss(second.id);
    expect((await capturesRepo.get(capture.id))?.status).toBe('review');
    await itemsRepo.accept(third.id);
    expect((await capturesRepo.get(capture.id))?.status).toBe('done');
    expect((await itemsRepo.get(second.id))?.status).toBe('dismissed');
  });

  it('acceptAll and dismissAll resolve every proposal of the capture at once', async () => {
    const { capture } = await reviewedCapture();
    const accepted = await itemsRepo.acceptAll(capture.id);
    expect(accepted.map((item) => item.status)).toEqual(['active', 'active', 'active']);
    expect((await capturesRepo.get(capture.id))?.status).toBe('done');

    const other = await capturesRepo.create({ kind: 'voice', text: 'ещё', status: 'review' });
    await itemsRepo.replaceProposed(other.id, [{ kind: 'task', title: 'x' }]);
    expect((await itemsRepo.dismissAll(other.id)).map((item) => item.status)).toEqual(['dismissed']);
  });

  it('reprocessing replaces open proposals but leaves accepted and dismissed items alone', async () => {
    const { capture, first, second } = await reviewedCapture();
    await itemsRepo.accept(first.id);
    await itemsRepo.dismiss(second.id);

    await itemsRepo.replaceProposed(capture.id, [{ kind: 'task', title: 'Новая версия' }]);

    const all = await itemsRepo.listByCapture(capture.id);
    expect(all.map((item) => `${item.title}:${item.status}`).sort()).toEqual(
      ['Новая версия:proposed', 'Первая:active', 'Вторая:dismissed'].sort(),
    );
    // The replaced proposal was never accepted, so it leaves no tombstone.
    expect(await db.tombstones.count()).toBe(0);
  });

  it('throws NotFoundError for an unknown item', async () => {
    await expect(itemsRepo.accept('nope')).rejects.toBeInstanceOf(NotFoundError);
    await expect(itemsRepo.dismiss('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('queries', () => {
  it('filters by kind, status, person, project, tag and capture, newest first', async () => {
    const person = await peopleRepo.create({ name: 'Иван' });
    const a = await itemsRepo.create({ kind: 'task', title: 'a', personIds: [person.id], tags: ['срочно'], createdAt: hour(0) });
    const b = await itemsRepo.create({ kind: 'task', title: 'b', projectIds: ['proj'], status: 'done', createdAt: hour(1) });
    await itemsRepo.create({ kind: 'lesson', title: 'c', createdAt: hour(2) });

    expect((await itemsRepo.list({ kind: 'task' })).map((item) => item.id)).toEqual([b.id, a.id]);
    expect((await itemsRepo.list({ kind: ['task', 'lesson'] }))).toHaveLength(3);
    expect((await itemsRepo.list({ kind: 'task', status: 'done' })).map((item) => item.id)).toEqual([b.id]);
    expect((await itemsRepo.list({ status: ['active', 'done'] }))).toHaveLength(3);
    expect((await itemsRepo.list({ personId: person.id })).map((item) => item.id)).toEqual([a.id]);
    expect((await itemsRepo.list({ projectId: 'proj' })).map((item) => item.id)).toEqual([b.id]);
    expect((await itemsRepo.list({ tag: 'срочно' })).map((item) => item.id)).toEqual([a.id]);
    expect(await itemsRepo.listByKind('lesson')).toHaveLength(1);
  });

  it('lists items due in a window', async () => {
    const inside = await itemsRepo.create({ kind: 'task', title: 'in', dueAt: hour(3) });
    await itemsRepo.create({ kind: 'task', title: 'before', dueAt: hour(-3) });
    await itemsRepo.create({ kind: 'task', title: 'at end', dueAt: hour(10) });
    const done = await itemsRepo.create({ kind: 'task', title: 'done', dueAt: hour(4) });
    await itemsRepo.setStatus(done.id, 'done');
    expect((await itemsRepo.listDueBetween(hour(0), hour(10))).map((item) => item.id)).toEqual([inside.id]);
  });
});

describe('deletion', () => {
  it('trash hides the item, restore brings it back', async () => {
    const item = await itemsRepo.create({ kind: 'task', title: 'x' });
    await itemsRepo.remove(item.id);
    expect(await itemsRepo.list()).toEqual([]);
    expect((await itemsRepo.get(item.id))?.deletedAt).toBeDefined();
    await itemsRepo.restore(item.id);
    expect(await itemsRepo.list()).toHaveLength(1);
  });

  it('removing the last open proposal finishes the capture review', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', text: 'x', status: 'review' });
    const [proposal] = await itemsRepo.replaceProposed(capture.id, [{ kind: 'task', title: 'x' }]);
    await itemsRepo.remove(proposal!.id);
    expect((await capturesRepo.get(capture.id))?.status).toBe('done');
  });

  it('destroy removes the row and its links and leaves a tombstone', async () => {
    const a = await itemsRepo.create({ kind: 'task', title: 'a' });
    const b = await itemsRepo.create({ kind: 'task', title: 'b' });
    await linksRepo.create({ from: a.id, to: b.id, kind: 'follows' });
    await itemsRepo.destroy(a.id);
    expect(await itemsRepo.get(a.id)).toBeUndefined();
    expect(await linksRepo.listFor(b.id)).toEqual([]);
    expect(await db.tombstones.get(a.id)).toMatchObject({ table: 'items' });
  });
});
