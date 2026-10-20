import { beforeEach, describe, expect, it } from 'vitest';
import {
  deleteDemoData,
  hasDemoData,
  runStartupMaintenance,
  wipeAll,
} from './maintenance';
import { audioRepo, capturesRepo, checkinsRepo, itemsRepo, linksRepo, patternsRepo, peopleRepo, profileRepo, projectsRepo, reviewsRepo, usageRepo } from './repos';
import { db } from './schema';
import { updateSettings, getSettings, defaultSettings } from './settings';
import {
  TRASH_RETENTION_DAYS,
  countTrash,
  destroyFromTrash,
  emptyTrash,
  listTrash,
  purgeTrash,
  restoreFromTrash,
} from './trash';

beforeEach(wipeAll);

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): string => new Date(Date.now() - days * DAY).toISOString();

/** Pretends a record has been in the trash since `deletedAt`. */
async function trashedAt(table: 'captures' | 'items' | 'people' | 'projects' | 'checkins' | 'patterns' | 'reviews', id: string, deletedAt: string) {
  await (db[table] as unknown as { update(id: string, changes: object): Promise<number> }).update(id, { deletedAt, updatedAt: deletedAt });
}

describe('trash', () => {
  it('lists trashed records of every table with a readable title, most recent first', async () => {
    const capture = await capturesRepo.create({ kind: 'text', text: 'Разговор с Машей про цену', title: undefined });
    const item = await itemsRepo.create({ kind: 'task', title: 'Позвонить' });
    const person = await peopleRepo.create({ name: 'Маша' });
    const live = await peopleRepo.create({ name: 'Живой' });
    await capturesRepo.remove(capture.id);
    await itemsRepo.remove(item.id);
    await peopleRepo.remove(person.id);
    await trashedAt('captures', capture.id, daysAgo(3));
    await trashedAt('people', person.id, daysAgo(1));

    const trash = await listTrash();
    expect(trash.map((entry) => `${entry.table}:${entry.title}`)).toEqual([
      'items:Позвонить',
      'people:Маша',
      'captures:Разговор с Машей про цену',
    ]);
    expect(trash.some((entry) => entry.id === live.id)).toBe(false);
    expect(await countTrash()).toBe(3);
  });

  it('restores one record from the trash', async () => {
    const item = await itemsRepo.create({ kind: 'task', title: 'x' });
    await itemsRepo.remove(item.id);
    await restoreFromTrash({ table: 'items', id: item.id });
    expect(await listTrash()).toEqual([]);
    expect(await itemsRepo.list()).toHaveLength(1);
  });

  it('deletes one record for good, with the cascade of its table', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', text: 'x', status: 'done' });
    const kept = await itemsRepo.create({ kind: 'lesson', title: 'Вывод', captureId: capture.id });
    await audioRepo.save(capture.id, new Blob(['a']));
    await capturesRepo.remove(capture.id);

    await destroyFromTrash({ table: 'captures', id: capture.id });

    expect(await capturesRepo.get(capture.id)).toBeUndefined();
    expect(await audioRepo.getForCapture(capture.id)).toBeUndefined();
    expect(await itemsRepo.get(kept.id)).toMatchObject({ sourceDeleted: true });
  });

  it('purges only what has been there for 30 days or longer', async () => {
    const stale = await capturesRepo.create({ kind: 'text', text: 'старая' });
    const edge = await itemsRepo.create({ kind: 'task', title: 'ровно 30 дней' });
    const fresh = await peopleRepo.create({ name: 'Свежий' });
    const staleProject = await projectsRepo.create({ name: 'Забытый' });
    const staleCheckIn = await checkinsRepo.create({ valence: 0, energy: 0.5 });
    const stalePattern = await patternsRepo.create({ title: 'p', description: '', kind: 'other' });
    const staleReview = await reviewsRepo.upsert({ period: 'day', startDay: '2026-01-01', endDay: '2026-01-01' });
    const alive = await peopleRepo.create({ name: 'Живой' });
    for (const [table, id] of [
      ['captures', stale.id],
      ['items', edge.id],
      ['people', fresh.id],
      ['projects', staleProject.id],
      ['checkins', staleCheckIn.id],
      ['patterns', stalePattern.id],
      ['reviews', staleReview.id],
    ] as const) {
      await trashedAt(table, id, daysAgo(table === 'people' ? 29 : table === 'items' ? TRASH_RETENTION_DAYS : 45));
    }

    expect(await purgeTrash()).toBe(6);

    expect((await listTrash()).map((entry) => entry.id)).toEqual([fresh.id]);
    expect(await peopleRepo.get(alive.id)).toBeDefined();
    expect(await db.tombstones.get(stale.id)).toMatchObject({ table: 'captures' });
    expect(await db.tombstones.get(staleReview.id)).toMatchObject({ table: 'reviews' });
  });

  it('purging a capture also takes its trashed proposals along (they are not counted twice)', async () => {
    const capture = await capturesRepo.create({ kind: 'voice', text: 'x', status: 'review' });
    const [proposal] = await itemsRepo.replaceProposed(capture.id, [{ kind: 'task', title: 'x' }]);
    await itemsRepo.remove(proposal!.id);
    await capturesRepo.remove(capture.id);
    await trashedAt('captures', capture.id, daysAgo(40));
    await trashedAt('items', proposal!.id, daysAgo(40));

    expect(await purgeTrash()).toBe(1);
    expect(await itemsRepo.get(proposal!.id)).toBeUndefined();
    expect(await listTrash()).toEqual([]);
  });

  it('empties the whole trash', async () => {
    const a = await itemsRepo.create({ kind: 'task', title: 'a' });
    const b = await peopleRepo.create({ name: 'Б' });
    await itemsRepo.remove(a.id);
    await peopleRepo.remove(b.id);
    expect(await emptyTrash()).toBe(2);
    expect(await listTrash()).toEqual([]);
  });

  it('runStartupMaintenance purges the old trash and never throws', async () => {
    const old = await peopleRepo.create({ name: 'Старый' });
    await peopleRepo.remove(old.id);
    await trashedAt('people', old.id, daysAgo(31));
    await expect(runStartupMaintenance()).resolves.toBeUndefined();
    expect(await peopleRepo.get(old.id)).toBeUndefined();
  });
});

describe('invariant 6: demo data goes in one operation', () => {
  it('removes every demo record, its dependents and its references, and keeps the user data', async () => {
    const demoPerson = await peopleRepo.create({ name: 'Демо Маша', isDemo: true });
    const demoProject = await projectsRepo.create({ name: 'Демо проект', isDemo: true });
    const demoCapture = await capturesRepo.create({ kind: 'voice', text: 'демо', isDemo: true, personIds: [demoPerson.id], projectIds: [demoProject.id] });
    const demoItem = await itemsRepo.create({ kind: 'task', title: 'Демо задача', isDemo: true, captureId: demoCapture.id });
    await checkinsRepo.create({ valence: 0, energy: 0.5, isDemo: true });
    await patternsRepo.create({ title: 'демо', description: '', kind: 'other', isDemo: true });
    await reviewsRepo.upsert({ period: 'week', startDay: '2026-09-28', endDay: '2026-10-04', isDemo: true });
    await audioRepo.save(demoCapture.id, new Blob(['a']));
    await linksRepo.create({ from: demoItem.id, to: demoCapture.id, kind: 'related' });

    const myPerson = await peopleRepo.create({ name: 'Настоящая Аня' });
    const myCapture = await capturesRepo.create({ kind: 'text', text: 'моя запись', personIds: [myPerson.id, demoPerson.id], projectIds: [demoProject.id] });
    const myItem = await itemsRepo.create({ kind: 'lesson', title: 'Мой вывод', personIds: [demoPerson.id] });

    expect(await hasDemoData()).toBe(true);
    expect(await deleteDemoData()).toBe(7);
    expect(await hasDemoData()).toBe(false);

    expect(await capturesRepo.list()).toHaveLength(1);
    expect(await itemsRepo.list()).toHaveLength(1);
    expect(await peopleRepo.list()).toHaveLength(1);
    expect(await projectsRepo.list()).toEqual([]);
    expect(await checkinsRepo.latest()).toBeUndefined();
    expect(await patternsRepo.list()).toEqual([]);
    expect(await reviewsRepo.list()).toEqual([]);
    expect(await db.audio.count()).toBe(0);
    expect(await db.links.count()).toBe(0);
    expect(await db.tombstones.count()).toBe(0);

    expect((await capturesRepo.get(myCapture.id))?.personIds).toEqual([myPerson.id]);
    expect((await capturesRepo.get(myCapture.id))?.projectIds).toEqual([]);
    expect((await itemsRepo.get(myItem.id))?.personIds).toEqual([]);
    expect((await peopleRepo.get(myPerson.id))?.mentionCount).toBe(1);
  });

  it('does nothing when there is no demo data', async () => {
    await peopleRepo.create({ name: 'Аня' });
    expect(await hasDemoData()).toBe(false);
    expect(await deleteDemoData()).toBe(0);
    expect(await peopleRepo.list()).toHaveLength(1);
  });
});

describe('wipeAll', () => {
  it('empties every table, settings and profile included', async () => {
    const capture = await capturesRepo.create({ kind: 'text', text: 'x' });
    await itemsRepo.create({ kind: 'task', title: 'x', captureId: capture.id });
    await peopleRepo.create({ name: 'Аня' });
    await audioRepo.save(capture.id, new Blob(['a']));
    await audioRepo.appendChunk({ captureId: 'c', seq: 0, data: new Blob(['x']) });
    await profileRepo.save({ name: 'Лев' });
    await updateSettings({ theme: 'light', ai: { anthropic: { apiKey: 'sk-1' } } });
    await usageRepo.record({ provider: 'p', model: 'm', purpose: 'test', inputTokens: 1, outputTokens: 1 });
    await capturesRepo.destroy(capture.id);

    await wipeAll();

    for (const table of db.tables) expect(await table.count(), table.name).toBe(0);
    expect(await getSettings()).toEqual(defaultSettings());
    expect((await profileRepo.get()).name).toBe('');
  });
});
