import { beforeEach, describe, expect, it } from 'vitest';
import { NAME_SCORE } from '../domain/names';
import { wipeAll } from './maintenance';
import { capturesRepo, itemsRepo, peopleRepo, presetsRepo, projectsRepo } from './repos';
import { db } from './schema';

beforeEach(wipeAll);

describe('people', () => {
  it('trims the name, defaults the role and starts the counters at zero', async () => {
    const person = await peopleRepo.create({ name: '  Маша  ' });
    expect(person).toMatchObject({ name: 'Маша', role: 'other', aliases: [], mentionCount: 0 });
    await expect(peopleRepo.create({ name: '   ' })).rejects.toThrow('Имя не может быть пустым');
  });

  it('keeps aliases unique and free of the name itself', async () => {
    const person = await peopleRepo.create({ name: 'Мария', aliases: ['Маша', 'маша', 'Мария', ' '] });
    expect(person.aliases).toEqual(['Маша']);
    const updated = await peopleRepo.addAlias(person.id, 'Машенька');
    expect(updated.aliases).toEqual(['Маша', 'Машенька']);
  });

  it('finds people by case forms, aliases and small typos, best match first', async () => {
    const masha = await peopleRepo.create({ name: 'Маша', aliases: ['Мария Иванова'] });
    await peopleRepo.create({ name: 'Борис' });

    for (const query of ['Маши', 'Машу', 'Машей', 'маша', 'Мария Иванова']) {
      expect((await peopleRepo.findByName(query))[0]?.entity.id).toBe(masha.id);
    }
    const typo = await peopleRepo.findByName('Машв');
    expect(typo[0]?.entity.id).toBe(masha.id);
    expect(typo[0]?.score).toBeLessThan(NAME_SCORE.exact);
    expect(await peopleRepo.findByName('Совсем другой')).toEqual([]);
  });

  it('orders the list by last mention, then name, and hides archived people unless asked', async () => {
    const quiet = await peopleRepo.create({ name: 'Борис' });
    const recent = await peopleRepo.create({ name: 'Вера' });
    const older = await peopleRepo.create({ name: 'Фёдор' });
    await capturesRepo.create({ kind: 'text', text: 'a', personIds: [older.id], createdAt: '2026-10-01T10:00:00.000Z' });
    await capturesRepo.create({ kind: 'text', text: 'b', personIds: [recent.id], createdAt: '2026-10-05T10:00:00.000Z' });

    expect((await peopleRepo.list()).map((person) => person.name)).toEqual(['Вера', 'Фёдор', 'Борис']);

    await peopleRepo.archive(quiet.id);
    expect((await peopleRepo.list()).map((person) => person.name)).toEqual(['Вера', 'Фёдор']);
    expect(await peopleRepo.list({ includeArchived: true })).toHaveLength(3);
    await peopleRepo.unarchive(quiet.id);
    expect(await peopleRepo.list()).toHaveLength(3);
  });

  it('filters by role', async () => {
    await peopleRepo.create({ name: 'Ученик', role: 'student' });
    await peopleRepo.create({ name: 'Родитель', role: 'parent' });
    expect((await peopleRepo.list({ role: 'parent' })).map((person) => person.name)).toEqual(['Родитель']);
  });

  it('merge moves every reference to the target and keeps the source name as an alias', async () => {
    const target = await peopleRepo.create({ name: 'Мария', notes: 'Мама Пети' });
    const source = await peopleRepo.create({ name: 'Маша', aliases: ['Машка'], notes: 'Дубль' });
    const capture = await capturesRepo.create({ kind: 'text', text: 'a', personIds: [source.id, target.id] });
    const only = await capturesRepo.create({ kind: 'text', text: 'b', personIds: [source.id] });
    const item = await itemsRepo.create({ kind: 'commitment', title: 'Позвонить', direction: 'i_owe', personIds: [source.id], counterpartyId: source.id });
    const preset = await presetsRepo.create({ name: 'Созвон', personIds: [source.id] });

    const merged = await peopleRepo.merge(source.id, target.id);

    expect(merged.aliases).toEqual(['Маша', 'Машка']);
    expect(merged.notes).toBe('Мама Пети\n\nДубль');
    expect(merged.mentionCount).toBe(2);
    expect(await peopleRepo.get(source.id)).toBeUndefined();
    expect((await capturesRepo.get(capture.id))?.personIds).toEqual([target.id]);
    expect((await capturesRepo.get(only.id))?.personIds).toEqual([target.id]);
    const movedItem = await itemsRepo.get(item.id);
    expect(movedItem?.personIds).toEqual([target.id]);
    expect(movedItem?.kind === 'commitment' && movedItem.counterpartyId).toBe(target.id);
    expect((await presetsRepo.get(preset.id))?.personIds).toEqual([target.id]);
    expect(await db.tombstones.get(source.id)).toMatchObject({ table: 'people' });
  });

  it('refuses to merge a person into themselves or into nobody', async () => {
    const person = await peopleRepo.create({ name: 'Маша' });
    await expect(peopleRepo.merge(person.id, person.id)).rejects.toThrow('Нельзя объединить человека с самим собой');
    await expect(peopleRepo.merge(person.id, 'missing')).rejects.toThrow('Человек не найден');
  });

  it('destroying a person strips references but keeps their name on commitments', async () => {
    const person = await peopleRepo.create({ name: 'Анна' });
    const capture = await capturesRepo.create({ kind: 'text', text: 'a', personIds: [person.id] });
    const commitment = await itemsRepo.create({ kind: 'commitment', title: 'Отправить', direction: 'i_owe', personIds: [person.id], counterpartyId: person.id });

    await peopleRepo.destroy(person.id);

    expect((await capturesRepo.get(capture.id))?.personIds).toEqual([]);
    const kept = await itemsRepo.get(commitment.id);
    expect(kept?.personIds).toEqual([]);
    expect(kept?.kind === 'commitment' && kept.counterpartyId).toBeUndefined();
    expect(kept?.kind === 'commitment' && kept.counterpartyName).toBe('Анна');
  });

  it('soft delete and restore', async () => {
    const person = await peopleRepo.create({ name: 'Анна' });
    await peopleRepo.remove(person.id);
    expect(await peopleRepo.list({ includeArchived: true })).toEqual([]);
    expect(await peopleRepo.getMany([person.id])).toEqual([]);
    await peopleRepo.restore(person.id);
    expect(await peopleRepo.list()).toHaveLength(1);
  });
});

describe('projects', () => {
  it('defaults, validates the name and sorts active first', async () => {
    const done = await projectsRepo.create({ name: 'Старый', status: 'done' });
    const active = await projectsRepo.create({ name: 'Школа', kind: 'business', keywords: ['онлайн-школа'] });
    expect(active).toMatchObject({ status: 'active', kind: 'business' });
    expect(done.kind).toBe('other');
    await expect(projectsRepo.create({ name: ' ' })).rejects.toThrow('Название проекта не может быть пустым');
    expect((await projectsRepo.list()).map((project) => project.name)).toEqual(['Школа', 'Старый']);
    expect(await projectsRepo.list({ status: 'done' })).toHaveLength(1);
  });

  it('finds projects by name and keywords', async () => {
    const school = await projectsRepo.create({ name: 'Онлайн-школа', keywords: ['курсы'] });
    await projectsRepo.create({ name: 'Бот' });
    expect((await projectsRepo.findByName('онлайн школа'))[0]?.project.id).toBe(school.id);
    expect((await projectsRepo.findByName('курсы'))[0]?.project.id).toBe(school.id);
  });

  it('destroy removes the project from captures, items and presets', async () => {
    const project = await projectsRepo.create({ name: 'Школа' });
    const capture = await capturesRepo.create({ kind: 'text', text: 'a', projectIds: [project.id, 'other'] });
    const item = await itemsRepo.create({ kind: 'task', title: 'x', projectIds: [project.id] });
    const preset = await presetsRepo.create({ name: 'P', projectIds: [project.id] });

    await projectsRepo.destroy(project.id);

    expect((await capturesRepo.get(capture.id))?.projectIds).toEqual(['other']);
    expect((await itemsRepo.get(item.id))?.projectIds).toEqual([]);
    expect((await presetsRepo.get(preset.id))?.projectIds).toEqual([]);
    expect(await projectsRepo.get(project.id)).toBeUndefined();
  });
});
