import { beforeEach, describe, expect, it } from 'vitest';
import { peopleRepo, projectsRepo, wipeAll } from '../db';
import { resolveEntities } from './entities';
import type { EntityOptions } from './entities';
import { ExtractionSchema } from './prompts/schemas';

const item = (title: string, extra: Record<string, unknown> = {}) => ({ kind: 'task', title, confidence: 0.8, ...extra });

const extraction = (parts: { people?: unknown[]; projects?: unknown[]; items?: unknown[] } = {}) =>
  ExtractionSchema.parse({ title: 'Запись', summary: 'Итог', people: [], projects: [], items: [], ...parts });

const OPTIONS: EntityOptions = { updateRelationMood: true };

async function pools() {
  return { people: await peopleRepo.list({ includeArchived: true }), projects: await projectsRepo.list() };
}

beforeEach(wipeAll);

describe('resolveEntities: people', () => {
  it('creates people the model found and the ones only objects mention', async () => {
    const result = await resolveEntities(
      extraction({
        people: [{ name: 'Маша', role: 'family', aliases: ['Машенька'], note: 'мама Вани' }],
        items: [item('Позвонить Пете', { people: ['Петя'] }), item('Прислать план', { kind: 'commitment', direction: 'i_owe', counterparty: 'Борис' })],
      }),
      await pools(),
      OPTIONS,
    );

    expect(result.newPeople.map((person) => person.name).sort()).toEqual(['Борис', 'Маша', 'Петя']);
    const masha = result.newPeople.find((person) => person.name === 'Маша');
    expect(masha).toMatchObject({ role: 'family', aliases: ['Машенька'], notes: 'мама Вани' });
    expect(result.personId('Маша')).toBe(masha?.id);
    expect(result.personId('Машенька')).toBe(masha?.id);
    expect(result.personId('Борис')).toBeDefined();
    expect(result.personIds).toHaveLength(3);
    expect(await peopleRepo.list()).toHaveLength(3);
  });

  it('links to an existing person by a case form or an alias, without creating anyone', async () => {
    const masha = await peopleRepo.create({ name: 'Маша', aliases: ['Мария'] });
    const result = await resolveEntities(extraction({ people: [{ name: 'Машей' }, { name: 'Мария' }] }), await pools(), OPTIONS);
    expect(result.newPeople).toEqual([]);
    expect(result.personIds).toEqual([masha.id]);
    expect(result.personId('Машей')).toBe(masha.id);
  });

  it('keeps the fuller name when the record gives one, and the short one as an alias', async () => {
    const masha = await peopleRepo.create({ name: 'Маша' });
    const result = await resolveEntities(extraction({ people: [{ name: 'Маша Иванова' }] }), await pools(), OPTIONS);
    expect(result.newPeople).toEqual([]);
    expect(await peopleRepo.get(masha.id)).toMatchObject({ name: 'Маша Иванова', aliases: ['Маша'] });
    expect(result.personId('Маша Иванова')).toBe(masha.id);
  });

  it('resolves "Маша" and "Маша Иванова" of one record to one new person', async () => {
    const result = await resolveEntities(extraction({ people: [{ name: 'Маша' }, { name: 'Маша Иванова' }] }), await pools(), OPTIONS);
    expect(result.newPeople.map((person) => person.name)).toEqual(['Маша Иванова']);
    expect(result.personId('Маша')).toBe(result.personId('Маша Иванова'));
  });

  it('does not guess between two people with the same first name', async () => {
    await peopleRepo.create({ name: 'Маша Иванова' });
    await peopleRepo.create({ name: 'Маша Петрова' });
    const result = await resolveEntities(extraction({ people: [{ name: 'Маша' }] }), await pools(), OPTIONS);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0]).toMatchObject({ kind: 'person', name: 'Маша' });
    expect(result.ambiguous[0].candidates.map((candidate) => candidate.name).sort()).toEqual(['Маша Иванова', 'Маша Петрова']);
    expect(result.personId('Маша')).toBeUndefined();
    expect(result.newPeople).toEqual([]);
  });

  it('creates a look-alike but suggests merging it with the existing person', async () => {
    const existing = await peopleRepo.create({ name: 'Екатерина' });
    const result = await resolveEntities(extraction({ people: [{ name: 'Екатерена' }] }), await pools(), OPTIONS);
    expect(result.newPeople).toHaveLength(1);
    expect(result.mergeHints).toHaveLength(1);
    expect(result.mergeHints[0]).toMatchObject({ kind: 'person', created: { name: 'Екатерена' }, candidate: { id: existing.id, name: 'Екатерина' } });
  });

  it('leaves the author and archived people alone but still finds the latter', async () => {
    const old = await peopleRepo.create({ name: 'Пётр' });
    await peopleRepo.archive(old.id);
    const result = await resolveEntities(extraction({ people: [{ name: 'Фёдор' }, { name: 'Петра' }] }), await pools(), { ...OPTIONS, ignoreNames: ['Фёдор'] });
    expect(result.newPeople).toEqual([]);
    expect(result.personIds).toEqual([old.id]);
    expect(result.personId('Фёдор')).toBeUndefined();
  });

  it('moves how things stand with a person by the tone of the record, but only when asked', async () => {
    const igor = await peopleRepo.create({ name: 'Борис', relationMood: 0.5 });
    const mention = extraction({ people: [{ name: 'Борис', sentiment: -1 }] });
    await resolveEntities(mention, await pools(), { updateRelationMood: false });
    expect((await peopleRepo.get(igor.id))?.relationMood).toBe(0.5);

    await resolveEntities(mention, await pools(), OPTIONS);
    expect((await peopleRepo.get(igor.id))?.relationMood).toBeCloseTo(0.5 * 0.7 + -1 * 0.3, 5);

    const fresh = await resolveEntities(extraction({ people: [{ name: 'Новый', sentiment: 5 }] }), await pools(), OPTIONS);
    expect(fresh.newPeople[0].relationMood).toBe(1);
  });

  it('ignores names that are empty after trimming', async () => {
    const result = await resolveEntities(extraction({ people: [{ name: '   ' }], items: [item('Дело', { people: [''] })] }), await pools(), OPTIONS);
    expect(result.personIds).toEqual([]);
    expect(await peopleRepo.list()).toEqual([]);
  });
});

describe('resolveEntities: projects', () => {
  it('creates projects from the model and from objects, and finds existing ones by name or keyword', async () => {
    const everest = await projectsRepo.create({ name: 'Маяк', keywords: ['школа kpi'] });
    const result = await resolveEntities(
      extraction({
        projects: [{ name: 'Маяке', kind: 'business' }, { name: 'Блог', kind: 'product', keywords: ['телеграм'] }],
        items: [item('Дело', { projects: ['школа KPI', 'Рассылка'] })],
      }),
      await pools(),
      OPTIONS,
    );

    expect(result.newProjects.map((project) => project.name).sort()).toEqual(['Блог', 'Рассылка']);
    expect(result.projectId('Маяке')).toBe(everest.id);
    expect(result.projectId('школа KPI')).toBe(everest.id);
    expect(result.newProjects.find((project) => project.name === 'Блог')).toMatchObject({ kind: 'product', keywords: ['телеграм'] });
    expect(result.projectIds).toHaveLength(3);
  });

  it('reports an ambiguous project instead of guessing', async () => {
    await projectsRepo.create({ name: 'Курс математики' });
    await projectsRepo.create({ name: 'Курс физики' });
    const result = await resolveEntities(extraction({ projects: [{ name: 'Курс' }] }), await pools(), OPTIONS);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0]).toMatchObject({ kind: 'project', name: 'Курс' });
    expect(result.projectId('Курс')).toBeUndefined();
  });
});
