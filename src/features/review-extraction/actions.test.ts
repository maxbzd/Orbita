import { beforeEach, describe, expect, it } from 'vitest';
import { capturesRepo, itemsRepo, peopleRepo, projectsRepo, settingsRepo } from '../../db';
import { wipeAll } from '../../db/maintenance';
import type { Capture, ID, Item } from '../../domain/types';
import {
  AUTO_ACCEPT_THRESHOLD,
  acceptAllClear,
  acceptItem,
  answerClarification,
  clarifyChoices,
  createAndLinkPerson,
  dismissItem,
  linkPerson,
  mergePerson,
  mergeProject,
  rejectPerson,
  rejectProject,
  setAutoAccept,
  undoDecision,
} from './actions';

beforeEach(wipeAll);

async function reviewCapture(extra: Partial<Capture> = {}): Promise<Capture> {
  return capturesRepo.create({ kind: 'voice', text: 'Решил поднять цену. Пообещал Фёдору прислать план.', status: 'review', ...extra });
}

async function proposed(captureId: ID, title: string, extra: Record<string, unknown> = {}): Promise<Item> {
  return itemsRepo.create({ kind: 'task', title, status: 'proposed', captureId, ...extra } as itemsRepo.NewItem);
}

describe('accepting and dismissing', () => {
  it('«Принять всё» activates everything that is not a suspected duplicate, the duplicate waits', async () => {
    const capture = await reviewCapture();
    const original = await itemsRepo.create({ kind: 'task', title: 'Прислать план Фёдору', status: 'active' });
    const a = await proposed(capture.id, 'Поднять цену');
    const b = await proposed(capture.id, 'Позвонить Маше');
    const twin = await proposed(capture.id, 'Прислать план Фёдору', { duplicateOf: original.id });

    const accepted = await acceptAllClear(capture.id);

    expect(accepted.map((item) => item.id).sort()).toEqual([a.id, b.id].sort());
    expect((await itemsRepo.get(a.id))?.status).toBe('active');
    expect((await itemsRepo.get(twin.id))?.status).toBe('proposed');
    // One object is still undecided: the capture stays in review.
    expect((await capturesRepo.get(capture.id))?.status).toBe('review');
  });

  it('the capture settles to «done» with the last decision', async () => {
    const capture = await reviewCapture();
    const a = await proposed(capture.id, 'Первое');
    const b = await proposed(capture.id, 'Второе');

    await acceptItem(a.id);
    expect((await capturesRepo.get(capture.id))?.status).toBe('review');
    await dismissItem(b.id);

    expect((await itemsRepo.get(b.id))?.status).toBe('dismissed');
    expect((await capturesRepo.get(capture.id))?.status).toBe('done');
  });

  it('accepting with edits stores the edit in the same write', async () => {
    const capture = await reviewCapture();
    const a = await proposed(capture.id, 'Поднять цену');
    const accepted = await acceptItem(a.id, { title: 'Поднять цену до 1500 ₽', body: 'С декабря' });
    expect(accepted).toMatchObject({ status: 'active', title: 'Поднять цену до 1500 ₽', body: 'С декабря' });
  });

  it('«Отменить» brings a decision back to review, and the capture with it', async () => {
    const capture = await reviewCapture();
    const a = await proposed(capture.id, 'Единственное');
    await acceptItem(a.id);
    expect((await capturesRepo.get(capture.id))?.status).toBe('done');

    await undoDecision(a.id);

    expect((await itemsRepo.get(a.id))?.status).toBe('proposed');
    expect((await capturesRepo.get(capture.id))?.status).toBe('review');
    // And it can be decided differently.
    await dismissItem(a.id);
    expect((await itemsRepo.get(a.id))?.status).toBe('dismissed');
  });

  it('undo of an unknown object does nothing', async () => {
    await expect(undoDecision('nope')).resolves.toBeUndefined();
  });
});

describe('auto-accept switch', () => {
  it('turns on at 80 % and off without touching the threshold', async () => {
    await setAutoAccept(true);
    expect((await settingsRepo.getSettings()).autoAccept).toEqual({ enabled: true, minConfidence: AUTO_ACCEPT_THRESHOLD });
    await setAutoAccept(false);
    expect((await settingsRepo.getSettings()).autoAccept).toEqual({ enabled: false, minConfidence: AUTO_ACCEPT_THRESHOLD });
  });
});

describe('people the run found', () => {
  it('taking a mention back recomputes the counters and trashes a person who has no other mention', async () => {
    const person = await peopleRepo.create({ name: 'Фёдор' });
    const capture = await reviewCapture({ personIds: [person.id] });
    const other = await peopleRepo.create({ name: 'Маша' });
    await capturesRepo.update(capture.id, { personIds: [person.id, other.id] });
    const promise = await proposed(capture.id, 'Прислать план', { kind: 'commitment', direction: 'i_owe', counterpartyId: person.id, personIds: [person.id] });
    expect((await peopleRepo.get(person.id))?.mentionCount).toBe(1);

    await rejectPerson(person.id, capture.id);

    expect((await capturesRepo.get(capture.id))?.personIds).toEqual([other.id]);
    expect((await peopleRepo.get(other.id))?.mentionCount).toBe(1);
    expect((await peopleRepo.get(person.id))?.deletedAt).toBeDefined();
    const commitment = await itemsRepo.get(promise.id);
    expect(commitment).toMatchObject({ personIds: [], counterpartyName: 'Фёдор' });
    expect(commitment).not.toHaveProperty('counterpartyId', person.id);
  });

  it('a person mentioned elsewhere stays', async () => {
    const person = await peopleRepo.create({ name: 'Фёдор' });
    const first = await reviewCapture({ personIds: [person.id] });
    await reviewCapture({ personIds: [person.id] });
    expect((await peopleRepo.get(person.id))?.mentionCount).toBe(2);

    await rejectPerson(person.id, first.id);

    const after = await peopleRepo.get(person.id);
    expect(after?.deletedAt).toBeUndefined();
    expect(after?.mentionCount).toBe(1);
  });

  it('merging a new person into an existing one moves the mentions', async () => {
    const existing = await peopleRepo.create({ name: 'Фёдор Иванов' });
    await reviewCapture({ personIds: [existing.id] });
    const created = await peopleRepo.create({ name: 'Федор' });
    const capture = await reviewCapture({ personIds: [created.id] });

    const merged = await mergePerson(created.id, existing.id);

    expect(merged.mentionCount).toBe(2);
    expect(merged.aliases).toContain('Федор');
    expect((await capturesRepo.get(capture.id))?.personIds).toEqual([existing.id]);
    expect(await peopleRepo.get(created.id)).toBeUndefined();
  });

  it('picking one of several candidates, or a new person, links them to the capture', async () => {
    const sasha = await peopleRepo.create({ name: 'Саша К.' });
    const capture = await reviewCapture();

    await linkPerson(capture.id, sasha.id);
    await linkPerson(capture.id, sasha.id);
    expect((await capturesRepo.get(capture.id))?.personIds).toEqual([sasha.id]);
    expect((await peopleRepo.get(sasha.id))?.mentionCount).toBe(1);

    const fresh = await createAndLinkPerson(capture.id, 'Саша М.');
    expect((await capturesRepo.get(capture.id))?.personIds).toEqual([sasha.id, fresh.id]);
    expect(fresh.mentionCount).toBe(1);
  });
});

describe('projects the run found', () => {
  it('a new project is merged into an existing one', async () => {
    const existing = await projectsRepo.create({ name: 'Онлайн-школа' });
    const created = await projectsRepo.create({ name: 'Школа онлайн' });
    const capture = await reviewCapture({ projectIds: [created.id] });
    const item = await proposed(capture.id, 'Запустить набор', { projectIds: [created.id] });

    await mergeProject(created.id, existing.id, capture.id);

    expect((await capturesRepo.get(capture.id))?.projectIds).toEqual([existing.id]);
    expect((await itemsRepo.get(item.id))?.projectIds).toEqual([existing.id]);
    expect(await projectsRepo.get(created.id)).toBeUndefined();
  });

  it('rejecting a project that nothing else uses trashes it', async () => {
    const created = await projectsRepo.create({ name: 'Случайное слово' });
    const capture = await reviewCapture({ projectIds: [created.id] });

    await rejectProject(created.id, capture.id);

    expect((await capturesRepo.get(capture.id))?.projectIds).toEqual([]);
    expect((await projectsRepo.get(created.id))?.deletedAt).toBeDefined();
  });
});

describe('the clarifying question', () => {
  const people = [
    { id: 'p1', name: 'Маша' },
    { id: 'p2', name: 'Фёдор' },
  ] as never[];

  it('«Кому?» offers the people the user talks about, then generic ones', () => {
    const choices = clarifyChoices('Кому ты это обещал?', people);
    expect(choices.kind).toBe('people');
    expect(choices.options.map((o) => o.label)).toEqual(['Маша', 'Фёдор', 'Коллеге']);
    expect(choices.options[0]?.personId).toBe('p1');
    expect(clarifyChoices('Кому ты это обещал?', []).options.map((o) => o.label)).toEqual(['Коллеге', 'Другу', 'Партнёру']);
    expect(clarifyChoices('Who did you promise this to?', []).kind).toBe('people');
    expect(clarifyChoices('By when will you do it?', []).kind).toBe('when');
  });

  it('«Когда?» offers days, anything else is yes or no', () => {
    expect(clarifyChoices('К какому сроку это нужно?', []).kind).toBe('when');
    expect(clarifyChoices('Когда ты это сделаешь?', []).options.map((o) => o.label)).toEqual(['Сегодня', 'Завтра', 'На этой неделе']);
    expect(clarifyChoices('Это уже решено?', []).options.map((o) => o.label)).toEqual(['Да', 'Нет']);
  });

  it('the answer is kept under the text; a person answer links the person to the capture and the open commitment', async () => {
    const maria = await peopleRepo.create({ name: 'Мария' });
    const capture = await reviewCapture();
    const promise = await proposed(capture.id, 'Прислать план', { kind: 'commitment', direction: 'i_owe' });

    const updated = await answerClarification(capture.id, 'Кому ты это обещал?', 'Мария', { personId: maria.id });

    expect(updated.text.endsWith('[Уточнение] Кому ты это обещал? — Мария')).toBe(true);
    expect((await capturesRepo.get(capture.id))?.personIds).toEqual([maria.id]);
    expect((await peopleRepo.get(maria.id))?.mentionCount).toBe(1);
    expect(await itemsRepo.get(promise.id)).toMatchObject({ counterpartyId: maria.id, personIds: [maria.id] });
  });

  it('an answer without a person only adds the note', async () => {
    const capture = await reviewCapture();
    await answerClarification(capture.id, 'Когда?', 'Завтра');
    expect((await capturesRepo.get(capture.id))?.personIds).toEqual([]);
    expect((await capturesRepo.get(capture.id))?.text).toContain('Завтра');
  });
});
