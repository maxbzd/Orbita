import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportBackup, importBackup, serializeBackup, BackupError } from './backup';
import { wipeAll } from './maintenance';
import { audioRepo, capturesRepo, itemsRepo, peopleRepo } from './repos';
import { seedDemo } from './seed';
import { db } from './schema';
import { updateSettings } from './settings';

/** A backup without the moment it was made, rows in a fixed order: two of these are equal exactly when the data is. */
async function snapshot() {
  const file = await exportBackup({ includeAudio: true, includeSecrets: true });
  const { exportedAt: _at, ...rest } = file;
  const tables: Record<string, unknown> = {};
  for (const [name, rows] of Object.entries(rest.tables)) {
    tables[name] = Array.isArray(rows) ? [...rows].sort((a, b) => String((a as { id?: string }).id).localeCompare(String((b as { id?: string }).id))) : rows;
  }
  return JSON.parse(JSON.stringify({ ...rest, tables })) as { tables: Record<string, unknown[]> };
}

beforeEach(wipeAll);

describe('your data comes back exactly as it left', () => {
  it('export, wipe everything, import: the second export is the same as the first, recordings included', async () => {
    await seedDemo();
    const capture = await capturesRepo.create({ kind: 'voice', status: 'done', text: 'запись с голосом' });
    await audioRepo.save(capture.id, new Blob([new Uint8Array([1, 2, 3, 250, 251])], { type: 'audio/webm' }));
    await updateSettings({ ai: { anthropic: { apiKey: 'sk-ant-проверка' } } });
    const before = await snapshot();
    expect(before.tables.captures!.length).toBeGreaterThan(10);
    expect(before.tables.audio!.length).toBe(1);

    const text = serializeBackup(await exportBackup({ includeAudio: true, includeSecrets: true })); // through text, as a file would be
    await wipeAll();
    expect(await db.captures.count()).toBe(0);

    await importBackup(text, { mode: 'replace' });
    expect(await snapshot()).toEqual(before);
    const audio = await audioRepo.getForCapture(capture.id);
    expect([...new Uint8Array(await audio!.data.arrayBuffer())]).toEqual([1, 2, 3, 250, 251]);
  });

  it('importing the same file twice changes nothing the second time', async () => {
    await seedDemo();
    const text = serializeBackup(await exportBackup({ includeAudio: true, includeSecrets: true }));
    await importBackup(text, { mode: 'replace' });
    const once = await snapshot();
    await importBackup(text, { mode: 'merge' });
    expect(await snapshot()).toEqual(once);
  });
});

describe('a failure in the middle of an import', () => {
  it('rolls everything back: what was there is still there, nothing is half-replaced', async () => {
    const mine = await peopleRepo.create({ name: 'Ольга', role: 'client' });
    await itemsRepo.create({ kind: 'task', title: 'Моя задача' });
    const before = await snapshot();

    const donor = serializeBackup(await (async () => {
      await wipeAll();
      await seedDemo();
      return exportBackup({ includeAudio: true, includeSecrets: true });
    })());
    await wipeAll();
    await peopleRepo.create({ name: 'Ольга', role: 'client' });
    await itemsRepo.create({ kind: 'task', title: 'Моя задача' });
    const mineNow = await snapshot();
    expect(mineNow.tables.people).toHaveLength(before.tables.people!.length);

    // the disk gives up while a late table is written, after everything old was already cleared inside the transaction
    const proto = Object.getPrototypeOf(db.people) as { bulkPut: (...args: unknown[]) => Promise<unknown> };
    const original = proto.bulkPut;
    const spy = vi.spyOn(proto, 'bulkPut').mockImplementation(function (this: { name: string }, ...args: unknown[]) {
      return this.name === 'projects' ? Promise.reject(new Error('the disk failed')) : original.apply(this, args);
    });
    await expect(importBackup(donor, { mode: 'replace' })).rejects.toThrow('the disk failed');
    spy.mockRestore();

    expect((await peopleRepo.list()).map((p) => p.name)).toEqual(['Ольга']);
    expect((await itemsRepo.list()).map((i) => i.title)).toEqual(['Моя задача']);
    expect(await snapshot()).toEqual(mineNow);
    expect(mine.id).toBeDefined();
  });

  it('a damaged file is refused before anything is touched', async () => {
    await peopleRepo.create({ name: 'Ольга', role: 'client' });
    const before = await snapshot();
    await expect(importBackup('{ не json', { mode: 'replace' })).rejects.toBeInstanceOf(BackupError);
    await expect(importBackup(JSON.stringify({ format: 'something-else' }), { mode: 'replace' })).rejects.toBeInstanceOf(BackupError);
    await expect(importBackup(JSON.stringify({ format: 'orbit-backup-v1', encrypted: false, exportedAt: 'не дата', tables: {} }), { mode: 'replace' })).rejects.toBeInstanceOf(BackupError);
    expect(await snapshot()).toEqual(before);
  });
});
