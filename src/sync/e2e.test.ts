import { beforeEach, describe, expect, it } from 'vitest';
import { audioRepo, capturesRepo, db, itemsRepo, peopleRepo, updateSettings, wipeAll } from '../db';
import { toBase64 } from '@/crypto/bytes';
import { finishJoin, readJoinRequest, startJoin } from '@/crypto/pairing';
import { withE2E } from './e2e';
import { CLOUD_KEY_PURPOSE, importCloudKey, isEnvelope, makeCloudKey } from './e2eCrypto';
import { E2ELockedError, markAllUnsent, runSync } from './engine';
import { FakeCloud } from './testing';

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
  async use<T>(work: () => Promise<T>): Promise<T> {
    await load(this.state);
    try {
      return await work();
    } finally {
      this.state = await dump();
    }
  }
}

const sync = (c: FakeCloud, user = 'u1') => runSync(withE2E(c.backend(user)), { push: true });
const giveKey = async (raw: Uint8Array): Promise<void> => {
  await updateSettings({ e2e: { key: toBase64(raw), id: (await importCloudKey(raw)).id } });
};
const wholeCloud = (c: FakeCloud): string => JSON.stringify([...c.rows.values()].map((row) => row.data));
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

let a: Device;
let b: Device;
let key: Uint8Array<ArrayBuffer>;
beforeEach(async () => {
  await wipeAll();
  a = new Device();
  b = new Device();
  key = (await makeCloudKey()).raw;
});

describe('records in the cloud are sealed', () => {
  it('the cloud holds only envelopes: no name, no note, not even the key', async () => {
    const c = new FakeCloud();
    await a.use(async () => {
      await giveKey(key);
      await peopleRepo.create({ name: 'Ольга Сергеевна', role: 'client' });
      await itemsRepo.create({ kind: 'task', title: 'Купить подарок', body: 'любит джаз' });
      await sync(c);
    });
    expect(c.rows.size).toBeGreaterThanOrEqual(2);
    expect([...c.rows.values()].every((row) => isEnvelope(row.data))).toBe(true);
    const text = wholeCloud(c);
    for (const secret of ['Ольга', 'подарок', 'джаз', toBase64(key)]) expect(text).not.toContain(secret);
  });

  it('another device with the key reads everything, and edits keep merging field by field', async () => {
    const c = new FakeCloud();
    const id = await a.use(async () => {
      await giveKey(key);
      const item = await itemsRepo.create({ kind: 'task', title: 'Позвонить', body: 'первая\nвторая', tags: ['work'] });
      await sync(c);
      return item.id;
    });
    await b.use(async () => {
      await giveKey(key);
      await sync(c);
      expect((await itemsRepo.get(id))?.title).toBe('Позвонить');
    });
    await tick();
    await a.use(async () => {
      await itemsRepo.update(id, { title: 'Позвонить маме' });
    });
    await tick();
    await b.use(async () => {
      await itemsRepo.update(id, { tags: ['work', 'b'] });
    });
    for (const device of [a, b, a, b]) await device.use(() => sync(c));
    for (const device of [a, b]) {
      const item = await device.use(async () => itemsRepo.get(id));
      expect(item?.title).toBe('Позвонить маме');
      expect([...(item?.tags ?? [])].sort()).toEqual(['b', 'work']);
    }
    expect(wholeCloud(c)).not.toContain('маме');
  });

  it('deleting for good still clears the sealed record from the cloud', async () => {
    const c = new FakeCloud();
    const id = await a.use(async () => {
      await giveKey(key);
      const capture = await capturesRepo.create({ kind: 'text', text: 'Секрет', status: 'done' });
      await sync(c);
      return capture.id;
    });
    expect(c.table('captures')).toHaveLength(1);
    await tick();
    await a.use(async () => {
      await capturesRepo.remove(id);
      await capturesRepo.destroy(id);
      await sync(c);
    });
    expect(c.table('captures')).toHaveLength(0);
    expect(c.table('tombstones')).toHaveLength(1);
    expect(wholeCloud(c)).not.toContain('Секрет');
  });
});

describe('recordings are sealed too', () => {
  it('the bucket holds no readable sound, and another device hears the same thing', async () => {
    const c = new FakeCloud();
    const original = 'ЗВУК-ЗАПИСИ-1234567890';
    const captureId = await a.use(async () => {
      await giveKey(key);
      const capture = await capturesRepo.create({ kind: 'voice', status: 'done', text: 'заметка' });
      await audioRepo.save(capture.id, new Blob([original], { type: 'audio/webm;codecs=opus' }));
      await sync(c);
      return capture.id;
    });
    const stored = [...c.audio.values()];
    expect(stored).toHaveLength(1);
    expect(await stored[0]!.text()).not.toContain('ЗВУК');
    await b.use(async () => {
      await giveKey(key);
      await sync(c);
      const audio = await db.audio.where('captureId').equals(captureId).first();
      expect(await audio?.data.text()).toBe(original);
      expect(audio?.mime).toContain('audio/webm');
    });
  });

  it('a recording stored before encryption was turned on is still played', async () => {
    const c = new FakeCloud();
    const captureId = await a.use(async () => {
      const capture = await capturesRepo.create({ kind: 'voice', status: 'done', text: 'x' });
      await audioRepo.save(capture.id, new Blob(['plain-old'], { type: 'audio/webm' }));
      await sync(c);
      return capture.id;
    });
    await b.use(async () => {
      await giveKey(key);
      await sync(c);
      const audio = await db.audio.where('captureId').equals(captureId).first();
      expect(await audio?.data.text()).toBe('plain-old');
    });
  });
});

describe('turning it on for an account that already has plain data', () => {
  it('sends everything again sealed, so no plain copy stays in the cloud', async () => {
    const c = new FakeCloud();
    await a.use(async () => {
      const person = await peopleRepo.create({ name: 'Игорь Петров', role: 'client' });
      const capture = await capturesRepo.create({ kind: 'voice', status: 'done', text: 'встреча' });
      await audioRepo.save(capture.id, new Blob(['голос-игоря'], { type: 'audio/webm' }));
      await itemsRepo.create({ kind: 'task', title: 'Написать Игорю', personIds: [person.id] });
      await sync(c);
    });
    expect(wholeCloud(c)).toContain('Игорь');
    await a.use(async () => {
      await giveKey(key);
      await markAllUnsent();
      await sync(c);
    });
    expect(wholeCloud(c)).not.toContain('Игорь');
    expect(wholeCloud(c)).not.toContain('Написать');
    expect([...c.rows.values()].every((row) => isEnvelope(row.data))).toBe(true);
    for (const blob of c.audio.values()) expect(await blob.text()).not.toContain('голос');
  });
});

describe('a device without the key', () => {
  async function sealedCloud(): Promise<FakeCloud> {
    const c = new FakeCloud();
    await a.use(async () => {
      await giveKey(key);
      await peopleRepo.create({ name: 'Ольга', role: 'client' });
      await sync(c);
    });
    return c;
  }

  it('reads nothing, and sends nothing (it would put plain data next to sealed data)', async () => {
    const c = await sealedCloud();
    const before = wholeCloud(c);
    await b.use(async () => {
      await itemsRepo.create({ kind: 'task', title: 'Локальная' });
      await expect(sync(c)).rejects.toBeInstanceOf(E2ELockedError);
      expect(await peopleRepo.list()).toHaveLength(0);
    });
    expect(wholeCloud(c)).toBe(before);
    expect(wholeCloud(c)).not.toContain('Локальная');
  });

  it('a different key is told apart and changes nothing', async () => {
    const c = await sealedCloud();
    await b.use(async () => {
      await giveKey((await makeCloudKey()).raw);
      await expect(sync(c)).rejects.toBeInstanceOf(E2ELockedError);
      expect(await peopleRepo.list()).toHaveLength(0);
    });
  });

  it('joins through the quantum-safe exchange and then reads everything', async () => {
    const c = await sealedCloud();
    const request = await startJoin();
    const old = await readJoinRequest(request.code);
    expect(old.checkDigits).toBe(request.checkDigits);
    const answer = await old.seal(key, CLOUD_KEY_PURPOSE);
    const got = await finishJoin(request, answer, CLOUD_KEY_PURPOSE);
    expect(toBase64(got)).toBe(toBase64(key));
    await b.use(async () => {
      await expect(sync(c)).rejects.toBeInstanceOf(E2ELockedError);
      await giveKey(got);
      await db.syncmeta.delete('@cursor');
      await sync(c);
      expect((await peopleRepo.list()).map((person) => person.name)).toEqual(['Ольга']);
    });
  });
});
