import { nowISO } from '../../domain/dates';
import { newId } from '../../domain/ids';
import { rankByName, uniqueAliases } from '../../domain/names';
import type { NameMatch } from '../../domain/names';
import type { ID, Person, PersonRole } from '../../domain/types';
import {
  NotFoundError,
  allTables,
  hardDelete,
  isLive,
  notDeleted,
  patchRecord,
  restoreRecord,
  softDeleteRecord,
} from '../internal';
import { db } from '../schema';
import { t } from '../../i18n';

/** `mentionCount` and `lastMentionAt` are derived (invariant 4): see `recomputeMentions`. */
type Derived = 'mentionCount' | 'lastMentionAt';
type Managed = 'updatedAt' | 'deletedAt' | Derived;

export type NewPerson = Pick<Person, 'name'> & Partial<Omit<Person, 'name' | Managed>>;
export type PersonPatch = Partial<Omit<Person, 'id' | 'createdAt' | Managed>>;

export interface PeopleFilter {
  includeArchived?: boolean;
  role?: PersonRole;
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') throw new RangeError(t('The name cannot be empty'));
  return trimmed;
}

const normalizePerson = (next: Person): Person => {
  const name = cleanName(next.name);
  return { ...next, name, aliases: uniqueAliases(name, next.aliases) };
};

export async function create(input: NewPerson): Promise<Person> {
  const createdAt = input.createdAt ?? nowISO();
  const name = cleanName(input.name);
  const person: Person = {
    ...input,
    id: input.id ?? newId(),
    createdAt,
    updatedAt: createdAt,
    name,
    aliases: uniqueAliases(name, input.aliases ?? []),
    role: input.role ?? 'other',
    mentionCount: 0,
  };
  await db.people.add(person);
  // A caller-supplied id may already be referenced by captures (import, demo data).
  await recomputeMentions([person.id]);
  return (await db.people.get(person.id)) ?? person;
}

export async function get(id: ID): Promise<Person | undefined> {
  return db.people.get(id);
}

export async function getMany(ids: readonly ID[]): Promise<Person[]> {
  return (await db.people.bulkGet([...ids])).filter(isLive);
}

export async function update(id: ID, patch: PersonPatch): Promise<Person> {
  return patchRecord('people', id, patch, normalizePerson);
}

export async function addAlias(id: ID, alias: string): Promise<Person> {
  const person = await db.people.get(id);
  if (!person) throw new NotFoundError('people', id);
  return update(id, { aliases: [...person.aliases, alias] });
}

export const archive = (id: ID): Promise<Person> => update(id, { archived: true });
export const unarchive = (id: ID): Promise<Person> => update(id, { archived: undefined });

/** Most recently mentioned first, never-mentioned people last (then by name). */
export async function list({ includeArchived = false, role }: PeopleFilter = {}): Promise<Person[]> {
  const people = await db.people
    .filter((person) => notDeleted(person) && (includeArchived || !person.archived) && (!role || person.role === role))
    .toArray();
  return people.sort(
    (a, b) =>
      (b.lastMentionAt ?? '').localeCompare(a.lastMentionAt ?? '') || a.name.localeCompare(b.name, 'ru'),
  );
}

/**
 * People whose name or alias matches `query` (any case form, typos), best first.
 * Scores are `NAME_SCORE` values: callers decide what is certain enough to auto-link.
 */
export async function findByName(query: string, { includeArchived = true } = {}): Promise<NameMatch<Person>[]> {
  return rankByName(query, await list({ includeArchived }));
}

export async function remove(id: ID): Promise<Person> {
  return softDeleteRecord('people', id);
}

export async function restore(id: ID): Promise<Person> {
  return restoreRecord('people', id);
}

/** Replaces `fromId` by `toId` (or drops it) in an id list, keeping order and uniqueness. */
function replaceId(ids: readonly ID[], fromId: ID, toId?: ID): ID[] {
  const result: ID[] = [];
  for (const id of ids) {
    const mapped = id === fromId ? toId : id;
    if (mapped !== undefined && !result.includes(mapped)) result.push(mapped);
  }
  return result;
}

/** Rewrites every reference to `fromId`: to `toId`, or removes it when `toId` is omitted. */
async function rewriteReferences(fromId: ID, toId: ID | undefined, fromName: string): Promise<void> {
  await db.captures
    .where('personIds')
    .equals(fromId)
    .modify((capture) => {
      capture.personIds = replaceId(capture.personIds, fromId, toId);
    });
  await db.items
    .where('personIds')
    .equals(fromId)
    .modify((item) => {
      item.personIds = replaceId(item.personIds, fromId, toId);
    });
  await db.items
    .where('kind')
    .equals('commitment')
    .filter((item) => item.kind === 'commitment' && item.counterpartyId === fromId)
    .modify((item) => {
      if (item.kind !== 'commitment') return;
      if (toId) item.counterpartyId = toId;
      else {
        delete item.counterpartyId;
        item.counterpartyName ??= fromName;
      }
    });
  await db.presets
    .filter((preset) => preset.personIds.includes(fromId))
    .modify((preset) => {
      preset.personIds = replaceId(preset.personIds, fromId, toId);
    });
}

/**
 * Merges `sourceId` into `targetId`: all captures, items, commitments and presets move to the
 * target, the source's name and aliases become aliases of the target, the source row is deleted.
 */
export async function merge(sourceId: ID, targetId: ID): Promise<Person> {
  if (sourceId === targetId) throw new RangeError(t('A person cannot be merged with themselves'));
  return db.transaction('rw', allTables(), async () => {
    const [source, target] = await Promise.all([db.people.get(sourceId), db.people.get(targetId)]);
    if (!source) throw new NotFoundError('people', sourceId);
    if (!target) throw new NotFoundError('people', targetId);

    await rewriteReferences(sourceId, targetId, source.name);
    const notes = [target.notes, source.notes].filter((note): note is string => !!note?.trim());
    const merged = await update(targetId, {
      aliases: uniqueAliases(target.name, target.aliases, [source.name], source.aliases),
      notes: notes.length > 0 ? notes.join('\n\n') : undefined,
    });
    await hardDelete('people', sourceId);
    await recomputeMentions([targetId]);
    return (await db.people.get(merged.id)) ?? merged;
  });
}

/**
 * Deletes a person for good (trash purge). References are removed from captures, items and presets;
 * a commitment keeps the person's name as `counterpartyName`.
 */
export async function destroy(id: ID): Promise<void> {
  await db.transaction('rw', allTables(), async () => {
    const person = await db.people.get(id);
    if (person) await rewriteReferences(id, undefined, person.name);
    await hardDelete('people', id);
  });
}

/**
 * Invariant 4: `mentionCount` and `lastMentionAt` are recomputed, never edited by hand.
 * A mention is a capture that is not in the trash and lists the person in `personIds`;
 * `lastMentionAt` is the newest such capture's `createdAt`. Without arguments every person is refreshed.
 * Call after anything that changes which captures exist or whom they mention.
 */
export async function recomputeMentions(ids?: readonly ID[]): Promise<void> {
  await db.transaction('rw', db.people, db.captures, async () => {
    const people = ids
      ? (await db.people.bulkGet([...new Set(ids)])).filter((person): person is Person => person !== undefined)
      : await db.people.toArray();

    for (const person of people) {
      const captures = await db.captures.where('personIds').equals(person.id).filter(notDeleted).toArray();
      const lastMentionAt = captures.reduce<string | undefined>(
        (latest, capture) => (latest === undefined || capture.createdAt > latest ? capture.createdAt : latest),
        undefined,
      );
      if (person.mentionCount === captures.length && person.lastMentionAt === lastMentionAt) continue;

      const next: Person = { ...person, mentionCount: captures.length };
      if (lastMentionAt === undefined) delete next.lastMentionAt;
      else next.lastMentionAt = lastMentionAt;
      await db.people.put(next);
    }
  });
}
