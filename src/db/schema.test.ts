import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSIONS, STORES_V1, createDb } from './schema';

const opened: Dexie[] = [];
let counter = 0;
const uniqueName = (): string => `orbita-schema-test-${++counter}`;

afterEach(async () => {
  const databases = opened.splice(0);
  for (const database of databases) database.close();
  for (const database of databases) await Dexie.delete(database.name);
});

function track<T extends Dexie>(database: T): T {
  opened.push(database);
  return database;
}

describe('schema', () => {
  it('has every table of docs/DATA_MODEL.md plus the recording chunks', async () => {
    const database = track(createDb(uniqueName()));
    await database.open();
    expect(database.tables.map((table) => table.name).sort()).toEqual(
      [
        'audio',
        'captures',
        'checkins',
        'chunks',
        'items',
        'links',
        'patterns',
        'people',
        'presets',
        'profile',
        'projects',
        'reviews',
        'settings',
        'syncmeta',
        'tombstones',
        'usage',
      ].sort(),
    );
  });

  it('indexes items and captures as the contract says', async () => {
    const database = track(createDb(uniqueName()));
    await database.open();
    const items = database.table('items').schema;
    expect(items.primKey.name).toBe('id');
    expect(items.idxByName['[kind+status]']).toBeDefined();
    expect(items.idxByName.personIds?.multi).toBe(true);
    expect(items.idxByName.projectIds?.multi).toBe(true);
    expect(items.idxByName.dueAt).toBeDefined();

    const captures = database.table('captures').schema;
    for (const name of ['day', 'status', 'kind', 'createdAt']) expect(captures.idxByName[name]).toBeDefined();
    for (const name of ['personIds', 'projectIds', 'tags']) expect(captures.idxByName[name]?.multi).toBe(true);

    expect(database.table('reviews').schema.idxByName['[period+startDay]']).toBeDefined();
  });

  it('lists versions in strictly increasing order starting at 1', () => {
    const versions = SCHEMA_VERSIONS.map(({ version }) => version);
    expect(versions[0]).toBe(1);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
  });
});

describe('migrations', () => {
  it('upgrades data written by the previous version and keeps what was there', async () => {
    const name = uniqueName();
    const v1 = track(createDb(name, SCHEMA_VERSIONS.slice(0, 1)));
    await v1.table('captures').add({ id: 'c1', day: '2026-10-07', text: 'старая запись', status: 'done', kind: 'text' });
    await v1.table('people').add({ id: 'p1', name: 'Маша' });
    v1.close();

    const upgraded: string[] = [];
    const v2 = track(
      createDb(name, [
        ...SCHEMA_VERSIONS,
        {
          version: 4,
          stores: { captures: `${STORES_V1.captures}, pinned` },
          upgrade: async (tx) => {
            await tx.table('captures').toCollection().modify((capture: { id: string; pinned?: boolean }) => {
              capture.pinned = false;
              upgraded.push(capture.id);
            });
          },
        },
      ]),
    );
    await v2.open();

    expect(upgraded).toEqual(['c1']);
    expect(await v2.table('captures').get('c1')).toMatchObject({ text: 'старая запись', pinned: false });
    expect(await v2.table('people').get('p1')).toMatchObject({ name: 'Маша' });
    expect(v2.table('captures').schema.idxByName.pinned).toBeDefined();
    // Tables the new version did not mention are carried over unchanged.
    expect(v2.table('items').schema.idxByName['[kind+status]']).toBeDefined();
  });

  it('maps the roles of earlier versions to the current ones', async () => {
    const name = uniqueName();
    const old = track(createDb(name, SCHEMA_VERSIONS.slice(0, 2)));
    for (const [id, role] of [['a', 'student'], ['b', 'parent'], ['c', 'lead'], ['d', 'teacher'], ['e', 'friend']] as const) {
      await old.table('people').add({ id, name: id, role });
    }
    old.close();
    const upgraded = track(createDb(name));
    await upgraded.open();
    const roles = (await upgraded.table('people').orderBy('id').toArray()).map((person) => person.role);
    expect(roles).toEqual(['other', 'family', 'client', 'mentor', 'friend']);
  });

  it('does not run an upgrade on a fresh database', async () => {
    let ran = false;
    const database = track(
      createDb(uniqueName(), [...SCHEMA_VERSIONS, { version: 4, stores: {}, upgrade: () => void (ran = true) }]),
    );
    await database.open();
    expect(ran).toBe(false);
  });
});
