import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, capturesRepo, itemsRepo, peopleRepo, projectsRepo, createDb } from '../db';
import { wipeAll } from '../db/maintenance';
import { SearchIndex } from './engine';
import { buildIndex, ensureSearchIndex, searchIndex, startIndexSync, updateIndex } from './sync';
import { makeCapture, makePerson } from './test-records';

beforeEach(wipeAll);

const ids = (index: SearchIndex, query: string): string[] => index.search(query, { limit: 100 }).map((hit) => hit.id).sort();

describe('buildIndex', () => {
  it('indexes captures, items, people and projects, and skips trashed and dismissed ones', async () => {
    const index = new SearchIndex();
    const capture = await capturesRepo.create({ kind: 'text', text: 'Пообещал Маше позвонить' });
    const trashed = await capturesRepo.create({ kind: 'text', text: 'Пообещал Диме' });
    await capturesRepo.remove(trashed.id);
    const item = await itemsRepo.create({ kind: 'task', title: 'Позвонить Маше', captureId: capture.id });
    const dismissed = await itemsRepo.create({ kind: 'task', title: 'Позвонить Диме', status: 'proposed' });
    await itemsRepo.dismiss(dismissed.id);
    const person = await peopleRepo.create({ name: 'Маша' });
    const project = await projectsRepo.create({ name: 'Школа Маши' });

    expect(await buildIndex(db, index)).toBe(4);
    expect(ids(index, 'маше')).toEqual([capture.id, item.id, person.id, project.id].sort());
    expect(ids(index, 'школа')).toEqual([project.id]);
    expect(ids(index, 'диме')).toEqual([]);
  });

  it('only re-indexes what changed, and forgets what is gone', async () => {
    const index = new SearchIndex();
    const kept = await capturesRepo.create({ kind: 'text', text: 'Про цены' });
    const edited = await capturesRepo.create({ kind: 'text', text: 'Про скидки' });
    const removed = await capturesRepo.create({ kind: 'text', text: 'Про налоги' });
    await buildIndex(db, index);

    const before = index.version;
    await buildIndex(db, index);
    expect(index.version).toBe(before);

    await capturesRepo.update(edited.id, { text: 'Про бонусы' });
    await capturesRepo.destroy(removed.id);
    await buildIndex(db, index);

    expect(index.version).toBe(before + 1);
    expect(ids(index, 'цены')).toEqual([kept.id]);
    expect(ids(index, 'скидки')).toEqual([]);
    expect(ids(index, 'бонусы')).toEqual([edited.id]);
    expect(ids(index, 'налоги')).toEqual([]);
  });

  it('works with a database of its own', async () => {
    const other = createDb('orbita-search-test');
    try {
      await other.captures.add(makeCapture({ id: 'x', text: 'Заметка из другой базы' }));
      const index = new SearchIndex();
      expect(await buildIndex(other, index)).toBe(1);
      expect(ids(index, 'другой')).toEqual(['x']);
    } finally {
      await other.delete();
    }
  });
});

describe('updateIndex', () => {
  it('adds, replaces and removes records without a database', () => {
    const index = new SearchIndex();
    const capture = makeCapture({ id: 'a', text: 'про цены' });
    const person = makePerson({ id: 'p', name: 'Маша' });
    updateIndex([{ type: 'upsert', table: 'captures', record: capture }, { type: 'upsert', table: 'people', record: person }], index);
    expect(ids(index, 'цены')).toEqual(['a']);
    expect(ids(index, 'маша')).toEqual(['p']);

    updateIndex({ type: 'upsert', table: 'captures', record: { ...capture, text: 'про скидки', updatedAt: '2026-10-02T00:00:00.000Z' } }, index);
    expect(ids(index, 'цены')).toEqual([]);
    expect(ids(index, 'скидки')).toEqual(['a']);

    updateIndex({ type: 'remove', table: 'people', id: 'p' }, index);
    expect(ids(index, 'маша')).toEqual([]);
  });

  it('treats an upsert of a trashed record as a removal', () => {
    const index = new SearchIndex();
    const capture = makeCapture({ id: 'a', text: 'про цены' });
    updateIndex({ type: 'upsert', table: 'captures', record: capture }, index);
    updateIndex({ type: 'upsert', table: 'captures', record: { ...capture, deletedAt: '2026-10-02T00:00:00.000Z' } }, index);
    expect(index.size).toBe(0);
  });
});

describe('startIndexSync', () => {
  async function started() {
    const index = new SearchIndex();
    const sync = startIndexSync(db, index);
    return { index, sync };
  }

  it('follows creation, edits, trash and restore, and destruction of a capture', async () => {
    const { index, sync } = await started();
    try {
      const capture = await capturesRepo.create({ kind: 'text', text: 'Идея про лендинг' });
      await vi.waitFor(() => expect(ids(index, 'лендинг')).toEqual([capture.id]));

      await capturesRepo.update(capture.id, { text: 'Идея про рассылку' });
      await vi.waitFor(() => expect(ids(index, 'рассылку')).toEqual([capture.id]));
      expect(ids(index, 'лендинг')).toEqual([]);

      await capturesRepo.remove(capture.id);
      await vi.waitFor(() => expect(ids(index, 'рассылку')).toEqual([]));

      await capturesRepo.restore(capture.id);
      await vi.waitFor(() => expect(ids(index, 'рассылку')).toEqual([capture.id]));

      await capturesRepo.destroy(capture.id);
      await vi.waitFor(() => expect(index.size).toBe(0));
    } finally {
      sync.stop();
    }
  });

  it('follows items, people and projects, including a dismissed item', async () => {
    const { index, sync } = await started();
    try {
      const item = await itemsRepo.create({ kind: 'task', title: 'Проверить домашку', status: 'proposed' });
      const person = await peopleRepo.create({ name: 'Дмитрий' });
      const project = await projectsRepo.create({ name: 'Подготовка к OKR' });
      await vi.waitFor(() => expect(index.size).toBe(3));

      await peopleRepo.update(person.id, { name: 'Дмитрий Иванов', aliases: ['Дима'] });
      await vi.waitFor(() => expect(ids(index, 'дима')).toEqual([person.id]));

      await itemsRepo.dismiss(item.id);
      await vi.waitFor(() => expect(ids(index, 'домашку')).toEqual([]));

      await projectsRepo.remove(project.id);
      await vi.waitFor(() => expect(ids(index, 'okr')).toEqual([]));
    } finally {
      sync.stop();
    }
  });

  it('indexes the records of a bulk write and of a transaction once it has committed', async () => {
    const { index, sync } = await started();
    try {
      await db.captures.bulkAdd([makeCapture({ id: 'a', text: 'первая заметка' }), makeCapture({ id: 'b', text: 'вторая заметка' })]);
      await vi.waitFor(() => expect(ids(index, 'заметка')).toEqual(['a', 'b']));

      await db.transaction('rw', db.captures, db.people, async () => {
        await db.captures.put(makeCapture({ id: 'c', text: 'третья заметка' }));
        await db.people.put(makePerson({ id: 'p', name: 'Заметкин' }));
      });
      await vi.waitFor(() => expect(ids(index, 'заметк')).toEqual(['a', 'b', 'c', 'p']));
    } finally {
      sync.stop();
    }
  });

  it('empties the index when the tables are cleared', async () => {
    const { index, sync } = await started();
    try {
      await capturesRepo.create({ kind: 'text', text: 'Что-то важное' });
      await vi.waitFor(() => expect(index.size).toBe(1));
      await wipeAll();
      await vi.waitFor(() => expect(index.size).toBe(0));
    } finally {
      sync.stop();
    }
  });

  it('leaves the index alone when the transaction is rolled back', async () => {
    const { index, sync } = await started();
    try {
      await expect(
        db.transaction('rw', db.captures, async () => {
          await db.captures.put(makeCapture({ id: 'ghost', text: 'призрак' }));
          throw new Error('rollback');
        }),
      ).rejects.toThrow('rollback');
      // A committed write after it proves the hooks are alive and the queue has drained.
      await db.captures.put(makeCapture({ id: 'real', text: 'настоящая' }));
      await vi.waitFor(() => expect(ids(index, 'настоящая')).toEqual(['real']));
      expect(ids(index, 'призрак')).toEqual([]);
    } finally {
      sync.stop();
    }
  });

  it('notifies subscribers and stops listening after stop()', async () => {
    const { index, sync } = await started();
    const listener = vi.fn();
    index.subscribe(listener);

    await capturesRepo.create({ kind: 'text', text: 'раз' });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));

    sync.stop();
    await capturesRepo.create({ kind: 'text', text: 'два' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(index.size).toBe(1);
  });

  it('reports a failure to read instead of throwing into the database', async () => {
    const index = new SearchIndex();
    const onError = vi.fn();
    const sync = startIndexSync(db, index, onError);
    const spy = vi.spyOn(db.captures, 'bulkGet').mockRejectedValueOnce(new Error('boom'));
    try {
      await capturesRepo.create({ kind: 'text', text: 'не проиндексируется' });
      await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(index.size).toBe(0);

      // The next committed write is indexed again, and a full build repairs the gap.
      await buildIndex(db, index);
      expect(index.size).toBe(1);
    } finally {
      spy.mockRestore();
      sync.stop();
    }
  });
});

describe('ensureSearchIndex', () => {
  it('builds the application index and keeps it current; calling again is harmless', async () => {
    const before = await capturesRepo.create({ kind: 'text', text: 'Запись до запуска индекса' });
    await ensureSearchIndex();
    await ensureSearchIndex();
    expect(searchIndex.search('запуска').map((hit) => hit.id)).toEqual([before.id]);

    const after = await capturesRepo.create({ kind: 'text', text: 'Запись после запуска индекса' });
    await vi.waitFor(() => expect(searchIndex.search('после').map((hit) => hit.id)).toEqual([after.id]));
  });
});
