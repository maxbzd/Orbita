import { beforeEach, describe, expect, it } from 'vitest';
import { audioRepo, capturesRepo, db, itemsRepo, peopleRepo, profileRepo, wipeAll } from '../db';
import { AccountMismatchError, adoptAccount, runSync } from './engine';
import { FakeCloud } from './testing';

/** One database, several "devices": a device is a saved copy of every table. */
type Snapshot = Record<string, unknown[]>;
async function dump(): Promise<Snapshot> {
  const snapshot: Snapshot = {};
  for (const table of db.tables) snapshot[table.name] = await table.toArray();
  return snapshot;
}
async function load(snapshot: Snapshot | undefined): Promise<void> {
  await wipeAll();
  if (!snapshot) return;
  for (const table of db.tables) await table.bulkPut((snapshot[table.name] ?? []) as never[]);
}
class Device {
  private state: Snapshot | undefined;
  /** Runs `work` with this device's data in the database, then puts it away. */
  async use<T>(work: () => Promise<T>): Promise<T> {
    await load(this.state);
    try {
      return await work();
    } finally {
      this.state = await dump();
    }
  }
}

const sync = (c: FakeCloud, user = 'u1', push = true) => runSync(c.backend(user), { push });
const audio = (text = 'sound') => new Blob([text], { type: 'audio/webm' });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

let a: Device;
let b: Device;
beforeEach(async () => {
  await wipeAll();
  a = new Device();
  b = new Device();
});

describe('records travel between devices', () => {
  it('a new device receives everything the first one has, and a repeat sends nothing', async () => {
    const c = new FakeCloud();
    const first = await a.use(async () => {
      const person = await peopleRepo.create({ name: 'Маша', role: 'client' });
      const capture = await capturesRepo.create({ kind: 'text', text: 'Решил поднять цену', status: 'done', personIds: [person.id] });
      await itemsRepo.create({ kind: 'decision', title: 'Поднять цену', chosen: 'Поднять', captureId: capture.id });
      await profileRepo.save({ name: 'Фёдор', about: 'консультант' });
      return sync(c);
    });
    expect(first.pushed).toBeGreaterThanOrEqual(4);
    expect(await a.use(() => sync(c))).toMatchObject({ pushed: 0, applied: 0 });

    const second = await b.use(async () => {
      const report = await sync(c);
      return { report, captures: await capturesRepo.list(), items: await itemsRepo.list(), people: await peopleRepo.list(), profile: await profileRepo.get() };
    });
    expect(second.report.pushed).toBe(0);
    expect(second.captures.map((x) => x.text)).toEqual(['Решил поднять цену']);
    expect(second.items.map((x) => x.title)).toEqual(['Поднять цену']);
    expect(second.people.map((x) => x.name)).toEqual(['Маша']);
    expect(second.people[0]?.mentionCount).toBe(1);
    expect(second.profile.name).toBe('Фёдор');
  });

  it('the later edit wins whichever device made it, and nothing bounces back', async () => {
    const c = new FakeCloud();
    const id = await a.use(async () => {
      const item = await itemsRepo.create({ kind: 'task', title: 'Позвонить' });
      await sync(c);
      return item.id;
    });
    await b.use(() => sync(c));
    await tick();
    await a.use(async () => {
      await itemsRepo.update(id, { title: 'Позвонить маме' });
      await sync(c);
    });
    const seen = await b.use(async () => {
      await sync(c);
      return (await itemsRepo.get(id))?.title;
    });
    expect(seen).toBe('Позвонить маме');
    await tick();
    await b.use(async () => {
      await itemsRepo.update(id, { title: 'Позвонить папе' });
      expect((await sync(c)).pushed).toBe(1);
    });
    const back = await a.use(async () => {
      await sync(c);
      return (await itemsRepo.get(id))?.title;
    });
    expect(back).toBe('Позвонить папе');
    expect(await a.use(() => sync(c))).toMatchObject({ pushed: 0 });
  });

  it('an older copy cannot overwrite a newer one in the cloud', async () => {
    const c = new FakeCloud();
    const id = await a.use(async () => {
      const item = await itemsRepo.create({ kind: 'task', title: 'v1' });
      await sync(c);
      return item.id;
    });
    await b.use(() => sync(c));
    // B edits offline; A edits later and syncs first; B then syncs its older edit.
    await tick();
    await b.use(async () => {
      await itemsRepo.update(id, { title: 'edit of B' });
    });
    await tick();
    await a.use(async () => {
      await itemsRepo.update(id, { title: 'edit of A, later' });
      await sync(c);
    });
    await b.use(async () => {
      await sync(c);
      expect((await itemsRepo.get(id))?.title).toBe('edit of A, later');
    });
    expect((c.table('items') as { title: string }[])[0]?.title).toBe('edit of A, later');
  });

  it('moving to the trash and back is shared; so is deleting for good', async () => {
    const c = new FakeCloud();
    const { keep, doomed } = await a.use(async () => {
      const keepIt = await capturesRepo.create({ kind: 'text', text: 'оставить', status: 'done' });
      const doomedOne = await capturesRepo.create({ kind: 'text', text: 'удалить', status: 'done' });
      await sync(c);
      return { keep: keepIt.id, doomed: doomedOne.id };
    });
    await b.use(() => sync(c));

    await tick();
    await a.use(async () => {
      await capturesRepo.remove(keep);
      await sync(c);
    });
    await b.use(async () => {
      await sync(c);
      expect((await capturesRepo.get(keep))?.deletedAt).toBeDefined();
    });
    await tick();
    await a.use(async () => {
      await capturesRepo.restore(keep);
      await capturesRepo.remove(doomed);
      await capturesRepo.destroy(doomed);
      await sync(c);
    });
    expect(c.table('captures')).toHaveLength(1); // the destroyed one is gone from the cloud too
    expect(c.table('tombstones')).toHaveLength(1);
    await b.use(async () => {
      await sync(c);
      expect((await capturesRepo.get(keep))?.deletedAt).toBeUndefined();
      expect(await capturesRepo.get(doomed)).toBeUndefined();
    });
    // A third device that never saw the record does not get it back.
    const fresh = new Device();
    await fresh.use(async () => {
      await sync(c);
      expect(await capturesRepo.get(doomed)).toBeUndefined();
      expect((await capturesRepo.list()).map((x) => x.text)).toEqual(['оставить']);
    });
  });
});

describe('edits made on two devices are merged field by field', () => {
  async function shared(c: FakeCloud, extra: Record<string, unknown> = {}) {
    const id = await a.use(async () => {
      const item = await itemsRepo.create({ kind: 'task', title: 'Позвонить', body: 'первая строка\nвторая строка', tags: ['work'], ...extra });
      await sync(c);
      return item.id;
    });
    await b.use(() => sync(c));
    await tick();
    return id;
  }

  it('different fields edited on each device both survive', async () => {
    const c = new FakeCloud();
    const id = await shared(c);
    await a.use(async () => {
      await itemsRepo.update(id, { title: 'Позвонить маме' });
    });
    await tick();
    await b.use(async () => {
      await itemsRepo.update(id, { priority: 'high' } as never);
    });
    await tick();
    await a.use(() => sync(c));
    await b.use(() => sync(c));
    await a.use(() => sync(c));
    for (const device of [a, b]) {
      const item = await device.use(async () => itemsRepo.get(id));
      expect(item?.title).toBe('Позвонить маме');
      expect((item as { priority?: string }).priority).toBe('high');
    }
  });

  it('tags added on two devices are both kept', async () => {
    const c = new FakeCloud();
    const id = await shared(c);
    await a.use(async () => {
      await itemsRepo.update(id, { tags: ['work', 'a'] });
    });
    await tick();
    await b.use(async () => {
      await itemsRepo.update(id, { tags: ['work', 'b'] });
    });
    await tick();
    await a.use(() => sync(c));
    await b.use(() => sync(c));
    const merged = await b.use(async () => (await itemsRepo.get(id))?.tags);
    expect([...(merged ?? [])].sort()).toEqual(['a', 'b', 'work']);
  });

  it('the same field edited on both: the later one wins, and the loser is not resurrected', async () => {
    const c = new FakeCloud();
    const id = await shared(c);
    await b.use(async () => {
      await itemsRepo.update(id, { title: 'от B' });
    });
    await tick();
    await a.use(async () => {
      await itemsRepo.update(id, { title: 'от A, позже' });
      await sync(c);
    });
    await b.use(() => sync(c));
    await a.use(() => sync(c));
    expect(await a.use(async () => (await itemsRepo.get(id))?.title)).toBe('от A, позже');
    expect(await b.use(async () => (await itemsRepo.get(id))?.title)).toBe('от A, позже');
    expect(await b.use(() => sync(c))).toMatchObject({ pushed: 0 });
  });

  it('without a remembered base the later whole row still wins', async () => {
    const c = new FakeCloud();
    const id = await shared(c);
    await b.use(async () => {
      await db.syncmeta.clear();
      await itemsRepo.update(id, { title: 'от B' });
    });
    await tick();
    await a.use(async () => {
      await itemsRepo.update(id, { body: 'новое тело' });
      await sync(c);
    });
    await b.use(() => sync(c));
    const item = await b.use(async () => itemsRepo.get(id));
    expect(item?.body).toBe('новое тело');
  });

  it('devices converge: after everyone syncs, all copies are equal', async () => {
    const c = new FakeCloud();
    const id = await shared(c);
    await a.use(async () => {
      await itemsRepo.update(id, { title: 'A1', body: 'первая строка\nвторая строка\nA добавил' });
    });
    await tick();
    await b.use(async () => {
      await itemsRepo.update(id, { title: 'B1', tags: ['work', 'b'] });
    });
    await tick();
    await a.use(() => sync(c));
    await b.use(() => sync(c));
    await a.use(() => sync(c));
    await b.use(() => sync(c));
    const [x, y] = [await a.use(async () => itemsRepo.get(id)), await b.use(async () => itemsRepo.get(id))];
    expect(x).toEqual(y);
    expect(x?.body).toContain('A добавил');
    expect(x?.tags).toContain('b');
  });
});

describe('the server refuses an edit built on an out-of-date copy', () => {
  it('a write that names a base the cloud no longer has is reported, not stored', async () => {
    const c = new FakeCloud();
    const id = await a.use(async () => {
      const item = await itemsRepo.create({ kind: 'task', title: 'Позвонить' });
      await sync(c);
      return item.id;
    });
    const row = c.table('items')[0] as { updatedAt: string };
    const server = c.backend('u1');
    const stale = await server.upsert([{ tbl: 'items', id, data: { ...row, title: 'старое', updatedAt: '2999-01-01T00:00:00.000Z' }, ver: '2999-01-01T00:00:00.000Z', base: '2000-01-01T00:00:00.000Z' }]);
    expect(stale).toEqual({ conflicts: [`items:${id}`] });
    expect((c.table('items')[0] as { title: string }).title).toBe('Позвонить');
    const fresh = await server.upsert([{ tbl: 'items', id, data: { ...row, title: 'новое', updatedAt: '2999-01-01T00:00:00.000Z' }, ver: '2999-01-01T00:00:00.000Z', base: row.updatedAt }]);
    expect(fresh).toEqual({ conflicts: [] });
    expect((c.table('items')[0] as { title: string }).title).toBe('новое');
  });

  it('a device that loses the race reads again, merges, and sends the merged record in the same round', async () => {
    const c = new FakeCloud();
    const id = await a.use(async () => {
      const item = await itemsRepo.create({ kind: 'task', title: 'Позвонить', body: 'текст' });
      await sync(c);
      return item.id;
    });
    await b.use(() => sync(c));
    await tick();
    await b.use(async () => {
      await itemsRepo.update(id, { body: 'текст B' });
    });
    // while B is between reading and writing, another device changes the title in the cloud
    const inner = c.backend('u1');
    let raced = false;
    const racing = {
      ...inner,
      upsert: async (rows: Parameters<typeof inner.upsert>[0]) => {
        if (!raced) {
          raced = true;
          const current = c.table('items')[0] as { updatedAt: string };
          const stamp = new Date(Date.parse(current.updatedAt) + 60_000).toISOString();
          await inner.upsert([{ tbl: 'items', id, data: { ...current, title: 'Позвонить маме', updatedAt: stamp }, ver: stamp, base: current.updatedAt }]);
        }
        return inner.upsert(rows);
      },
    };
    const report = await b.use(async () => {
      const result = await runSync(racing, { push: true });
      const item = await itemsRepo.get(id);
      expect(item?.title).toBe('Позвонить маме');
      expect(item?.body).toBe('текст B');
      return result;
    });
    expect(report.pushed).toBe(1);
    const stored = c.table('items')[0] as { title: string; body: string };
    expect(stored).toMatchObject({ title: 'Позвонить маме', body: 'текст B' });
    await a.use(async () => {
      await sync(c);
      expect(await itemsRepo.get(id)).toMatchObject({ title: 'Позвонить маме', body: 'текст B' });
    });
  });
});

describe('what stays on the device', () => {
  it('demo data and recordings in the making are not sent', async () => {
    const c = new FakeCloud();
    await a.use(async () => {
      await capturesRepo.create({ kind: 'text', text: 'демо', status: 'done', isDemo: true });
      await capturesRepo.create({ kind: 'voice', text: '', status: 'raw' }); // the recorder's empty shell
      await capturesRepo.create({ kind: 'text', text: 'в работе', status: 'extracting' });
      await capturesRepo.create({ kind: 'text', text: 'готово', status: 'done' });
      await sync(c);
    });
    expect((c.table('captures') as { text: string }[]).map((x) => x.text)).toEqual(['готово']);
  });

  it('settings never travel', async () => {
    const c = new FakeCloud();
    await a.use(async () => {
      await db.settings.put({ id: 'settings', theme: 'dark' } as never);
      await sync(c);
    });
    expect([...c.rows.values()].some((row) => (row.tbl as string) === 'settings')).toBe(false);
  });
});

describe('recordings', () => {
  it('a recording goes up with its capture and comes down on another device', async () => {
    const c = new FakeCloud();
    const id = await a.use(async () => {
      const capture = await capturesRepo.create({ kind: 'voice', text: 'сказал', status: 'done', durationSec: 5 });
      await audioRepo.save(capture.id, audio('голос'));
      const report = await sync(c);
      expect(report.audioUp).toBe(1);
      return capture.id;
    });
    expect(c.audio.size).toBe(1);
    await b.use(async () => {
      const report = await sync(c);
      expect(report.audioDown).toBe(1);
      const stored = await audioRepo.getForCapture(id);
      expect(stored?.sizeBytes).toBe(audio('голос').size);
      expect((await capturesRepo.get(id))?.audioId).toBe(stored?.id);
      expect((await sync(c)).audioDown).toBe(0);
    });
  });

  it('deleting the recording, or its capture, removes it from the cloud and from the other device', async () => {
    const c = new FakeCloud();
    const { one, two } = await a.use(async () => {
      const first = await capturesRepo.create({ kind: 'voice', text: 'раз', status: 'done' });
      const second = await capturesRepo.create({ kind: 'voice', text: 'два', status: 'done' });
      await audioRepo.save(first.id, audio('1'));
      await audioRepo.save(second.id, audio('2'));
      await sync(c);
      return { one: first.id, two: second.id };
    });
    await b.use(() => sync(c));
    await tick();
    await a.use(async () => {
      await audioRepo.remove(one); // «Хранить аудио» switched off
      await capturesRepo.remove(two);
      await capturesRepo.destroy(two);
      await sync(c);
    });
    expect(c.audio.size).toBe(0);
    await b.use(async () => {
      await sync(c);
      expect(await audioRepo.getForCapture(one)).toBeUndefined();
      expect(await audioRepo.getForCapture(two)).toBeUndefined();
      expect((await capturesRepo.get(one))?.audioId).toBeUndefined();
    });
  });
});

describe('accounts and failures', () => {
  it('refuses to mix another account into this device until told how', async () => {
    const c = new FakeCloud();
    await a.use(async () => {
      await capturesRepo.create({ kind: 'text', text: 'моё', status: 'done' });
      await sync(c, 'u1');
      await expect(sync(c, 'u2')).rejects.toBeInstanceOf(AccountMismatchError);
      await adoptAccount({ userId: 'u2' }, 'replace');
      expect(await capturesRepo.list()).toEqual([]);
      expect(await sync(c, 'u2')).toMatchObject({ pushed: 0, pulled: 0 });
    });
    await b.use(async () => {
      await capturesRepo.create({ kind: 'text', text: 'чужое', status: 'done' });
      await sync(c, 'u1'); // takes the first device's record too
      await adoptAccount({ userId: 'u2' }, 'merge');
      expect((await sync(c, 'u2')).pushed).toBeGreaterThan(0);
    });
    expect((c.table('captures', 'u2') as { text: string }[]).map((x) => x.text).sort()).toEqual(['моё', 'чужое']);
  });

  it('a lost connection changes nothing and the next round finishes the job', async () => {
    const c = new FakeCloud();
    await a.use(async () => {
      await capturesRepo.create({ kind: 'text', text: 'не потеряй', status: 'done' });
      c.offline = true;
      await expect(sync(c)).rejects.toThrow('Failed to fetch');
      c.offline = false;
      expect((await sync(c)).pushed).toBe(1);
    });
    expect(c.table('captures')).toHaveLength(1);
  });

  it('rows another app version wrote in a shape this one does not know are skipped, not fatal', async () => {
    const c = new FakeCloud();
    await c.backend('u1').upsert([{ tbl: 'captures', id: 'bad', data: { id: 'bad', updatedAt: '2026-10-09T10:00:00.000Z', kind: 'hologram' } }]);
    await b.use(async () => {
      const report = await sync(c);
      expect(report.rejected).toBe(1);
      expect(await capturesRepo.list()).toEqual([]);
    });
  });
});

describe('big histories', () => {
  it('pages through more rows than one request carries', async () => {
    const c = new FakeCloud();
    await a.use(async () => {
      await db.captures.bulkPut(
        Array.from({ length: 1200 }, (_, index) => ({
          id: `c${String(index).padStart(4, '0')}`,
          kind: 'text',
          text: `запись ${index}`,
          status: 'done',
          createdAt: '2026-10-01T10:00:00.000Z',
          updatedAt: '2026-10-01T10:00:00.000Z',
          day: '2026-10-01',
          projectIds: [],
          personIds: [],
          tags: [],
        })) as never[],
      );
      expect((await sync(c)).pushed).toBe(1200);
    });
    await b.use(async () => {
      const report = await sync(c);
      expect(report.pulled).toBeGreaterThanOrEqual(1200);
      expect(await db.captures.count()).toBe(1200);
    });
  });
});
