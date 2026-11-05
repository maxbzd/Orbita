import { beforeEach, describe, expect, it } from 'vitest';
import { BackupError, exportBackup, importBackup } from './backup';
import { wipeAll } from './maintenance';
import { capturesRepo, itemsRepo, peopleRepo } from './repos';
import { db } from './schema';

function rng(seed: number) {
  let s = seed;
  const next = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  return { next, int: (n: number) => Math.floor(next() * n) };
}

/** Damage a copy of the backup in one random way: drop a field, give it the wrong type, empty a table, break an id. */
function damage(data: Record<string, any>, r: ReturnType<typeof rng>): Record<string, any> {
  const copy = structuredClone(data);
  const tables = Object.keys(copy.tables).filter((t) => Array.isArray(copy.tables[t]) && copy.tables[t].length);
  const table = tables[r.int(tables.length)]!;
  const row = copy.tables[table][r.int(copy.tables[table].length)];
  const fields = Object.keys(row);
  const field = fields[r.int(fields.length)]!;
  const wrong: unknown[] = [null, 42, 'x', [], {}, true, [null], { a: 1 }, -1, ''];
  switch (r.int(7)) {
    case 0:
      delete row[field];
      break;
    case 1:
      row[field] = wrong[r.int(wrong.length)];
      break;
    case 2:
      copy.tables[table] = wrong[r.int(wrong.length)];
      break;
    case 3:
      copy.tables[table] = [];
      break;
    case 4:
      row.id = wrong[r.int(wrong.length)];
      break;
    case 5:
      copy.tables[table].push(null);
      break;
    default:
      copy.schemaVersion = wrong[r.int(wrong.length)];
      break;
  }
  return copy;
}

const snapshot = async (): Promise<string> =>
  JSON.stringify(await Promise.all(db.tables.map(async (t) => [t.name, (await t.toArray()).sort((a: any, b: any) => String(a.id ?? a.key).localeCompare(String(b.id ?? b.key)))])));

describe('importing a damaged backup (random damage)', () => {
  let original: Record<string, any>;
  beforeEach(async () => {
    await wipeAll();
    const person = await peopleRepo.create({ name: 'Маша', role: 'client' });
    const capture = await capturesRepo.create({ kind: 'text', text: 'Решил поднять цену', status: 'done', personIds: [person.id] });
    await itemsRepo.create({ kind: 'decision', title: 'Поднять цену', chosen: 'Да', captureId: capture.id });
    await itemsRepo.create({ kind: 'commitment', title: 'Отправить договор', direction: 'i_owe', counterpartyId: person.id });
    original = JSON.parse(JSON.stringify(await exportBackup()));
  });

  it('is either refused with a plain message and nothing changed, or imported completely: never a crash, never half', async () => {
    const crashes: string[] = [];
    let refused = 0;
    let accepted = 0;
    for (let i = 0; i < 300; i++) {
      const bad = damage(original, rng(i + 1));
      await wipeAll();
      await peopleRepo.create({ name: 'Прежний', role: 'client' });
      const before = await snapshot();
      try {
        await importBackup(bad as never, { mode: 'replace' });
        accepted++;
      } catch (e) {
        if (e instanceof BackupError) {
          refused++;
          if ((await snapshot()) !== before) crashes.push(`#${i} changed the data although refused`);
        } else {
          crashes.push(`#${i} ${(e as Error)?.constructor?.name}: ${(e as Error)?.message?.slice(0, 80)}`);
          if ((await snapshot()) !== before) crashes.push(`#${i} left the data half-changed after a crash`);
        }
      }
    }
    expect(crashes.slice(0, 8)).toEqual([]);
    expect(refused).toBeGreaterThan(20);
    expect(accepted).toBeGreaterThan(5);
  }, 120_000);
});
