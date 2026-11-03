import { beforeEach, describe, expect, it } from 'vitest';
import { deleteRecordings, findOldRecordings } from './audioSpace';
import { wipeAll } from './maintenance';
import { audioRepo, capturesRepo } from './repos';
import { db } from './schema';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const daysAgo = (n: number): string => new Date(NOW - n * 86_400_000).toISOString();

beforeEach(wipeAll);

async function recorded(text: string, ageDays: number, status: 'done' | 'raw' = 'done', bytes = 1000) {
  const capture = await capturesRepo.create({ kind: 'voice', status, text });
  await db.captures.update(capture.id, { createdAt: daysAgo(ageDays) });
  await audioRepo.save(capture.id, new Blob([new Uint8Array(bytes)], { type: 'audio/webm' }));
  return capture.id;
}

describe('recordings that can go when the room runs out', () => {
  it('offers only old, finished records whose words are saved as text', async () => {
    const old = await recorded('давнишняя мысль', 45);
    await recorded('свежая мысль', 3);
    await recorded('', 60); // no words saved: the sound is the only copy
    await recorded('ещё в обработке', 60, 'raw');

    const found = await findOldRecordings(30, NOW);
    expect(found.captureIds).toEqual([old]);
    expect(found.bytes).toBe(1000);
  });

  it('never offers a record in the trash, or one whose text is blank space', async () => {
    const trashed = await recorded('в корзине', 90);
    await capturesRepo.remove(trashed);
    await recorded('   ', 90);
    expect((await findOldRecordings(30, NOW)).captureIds).toEqual([]);
  });

  it('deleting removes the sound and keeps the text', async () => {
    const id = await recorded('останется текст', 45);
    expect(await deleteRecordings([id])).toBe(1);
    expect(await audioRepo.getForCapture(id)).toBeUndefined();
    const capture = await capturesRepo.get(id);
    expect(capture?.text).toBe('останется текст');
    expect(capture?.audioId).toBeUndefined();
    expect((await findOldRecordings(30, NOW)).captureIds).toEqual([]);
  });
});
