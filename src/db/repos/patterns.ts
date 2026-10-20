import { localDayKey, nowISO } from '../../domain/dates';
import { newId } from '../../domain/ids';
import type { ID, Pattern, PatternStatus } from '../../domain/types';
import { allTables, clamp, hardDelete, isLive, notDeleted, patchRecord, restoreRecord, softDeleteRecord } from '../internal';
import { db } from '../schema';
import * as links from './links';

type Managed = 'updatedAt' | 'deletedAt';

/**
 * Defaults: no evidence, `confidence` 0.5, `status` candidate; `firstSeenDay`/`lastSeenDay` come from the
 * evidence (or today) and `occurrences` from its length.
 */
export type NewPattern = Pick<Pattern, 'title' | 'description' | 'kind'> &
  Partial<Omit<Pattern, 'title' | 'description' | 'kind' | Managed>>;
export type PatternPatch = Partial<Omit<Pattern, 'id' | 'createdAt' | Managed>>;

const normalizePattern = (pattern: Pattern): Pattern => ({ ...pattern, confidence: clamp(pattern.confidence, 0, 1) });

export async function create(input: NewPattern): Promise<Pattern> {
  const createdAt = input.createdAt ?? nowISO();
  const evidence = input.evidence ?? [];
  const days = evidence.map((entry) => entry.day).sort();
  const pattern = normalizePattern({
    ...input,
    id: input.id ?? newId(),
    createdAt,
    updatedAt: createdAt,
    evidence,
    confidence: input.confidence ?? 0.5,
    status: input.status ?? 'candidate',
    firstSeenDay: input.firstSeenDay ?? days[0] ?? localDayKey(createdAt),
    lastSeenDay: input.lastSeenDay ?? days[days.length - 1] ?? localDayKey(createdAt),
    occurrences: input.occurrences ?? evidence.length,
  });
  await db.patterns.add(pattern);
  return pattern;
}

export async function get(id: ID): Promise<Pattern | undefined> {
  return db.patterns.get(id);
}

export async function getMany(ids: readonly ID[]): Promise<Pattern[]> {
  return (await db.patterns.bulkGet([...ids])).filter(isLive);
}

export async function update(id: ID, patch: PatternPatch): Promise<Pattern> {
  return patchRecord('patterns', id, patch, normalizePattern);
}

/** "Да, это про меня" / "нет" / "уже не актуально". */
export const setStatus = (id: ID, status: PatternStatus): Promise<Pattern> => update(id, { status });

/** Patterns (optionally of one status), most recently seen first. */
export async function list({ status }: { status?: PatternStatus } = {}): Promise<Pattern[]> {
  const source = status ? db.patterns.where('status').equals(status) : db.patterns.toCollection();
  const patterns = await source.filter(notDeleted).toArray();
  return patterns.sort((a, b) => b.lastSeenDay.localeCompare(a.lastSeenDay) || b.confidence - a.confidence);
}

export async function remove(id: ID): Promise<Pattern> {
  return softDeleteRecord('patterns', id);
}

export async function restore(id: ID): Promise<Pattern> {
  return restoreRecord('patterns', id);
}

export async function destroy(id: ID): Promise<void> {
  await db.transaction('rw', allTables(), async () => {
    await links.removeFor(id);
    await hardDelete('patterns', id);
  });
}
