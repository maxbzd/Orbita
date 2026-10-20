import { localDayKey, nowISO } from '../../domain/dates';
import { newId } from '../../domain/ids';
import type { CheckIn, DayKey, ID } from '../../domain/types';
import {
  NotFoundError,
  clamp,
  hardDelete,
  isLive,
  notDeleted,
  patchRecord,
  restoreRecord,
  softDeleteRecord,
} from '../internal';
import { db } from '../schema';

type Managed = 'updatedAt' | 'deletedAt';

/**
 * `valence`, `energy` and `origin` are the minimum. Defaults: `at` now, `day` the local day of `at`,
 * no tags, `origin` manual. Scales are clamped: valence −1..1, energy/focus/stress 0..1.
 */
export type NewCheckIn = Pick<CheckIn, 'valence' | 'energy'> & Partial<Omit<CheckIn, 'valence' | 'energy' | Managed>>;
export type CheckInPatch = Partial<Omit<CheckIn, 'id' | 'createdAt' | Managed>>;

const optionalUnit = (value: number | undefined): number | undefined =>
  value === undefined ? undefined : clamp(value, 0, 1);

function normalizeCheckIn(checkIn: CheckIn): CheckIn {
  const next: CheckIn = {
    ...checkIn,
    valence: clamp(checkIn.valence, -1, 1),
    energy: clamp(checkIn.energy, 0, 1),
  };
  for (const key of ['focus', 'stress'] as const) {
    const value = optionalUnit(checkIn[key]);
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  if (next.sleepHours !== undefined) next.sleepHours = clamp(next.sleepHours, 0, 24);
  return next;
}

export async function create(input: NewCheckIn): Promise<CheckIn> {
  const at = input.at ?? nowISO();
  const createdAt = input.createdAt ?? at;
  const checkIn = normalizeCheckIn({
    ...input,
    id: input.id ?? newId(),
    createdAt,
    updatedAt: createdAt,
    at,
    day: input.day ?? localDayKey(at),
    tags: input.tags ?? [],
    origin: input.origin ?? 'manual',
  });
  await db.checkins.add(checkIn);
  return checkIn;
}

export async function get(id: ID): Promise<CheckIn | undefined> {
  return db.checkins.get(id);
}

export async function update(id: ID, patch: CheckInPatch): Promise<CheckIn> {
  return patchRecord('checkins', id, patch, normalizeCheckIn);
}

/** The user accepted a state the AI had suggested. */
export async function confirm(id: ID): Promise<CheckIn> {
  const checkIn = await db.checkins.get(id);
  if (!checkIn) throw new NotFoundError('checkins', id);
  return checkIn.origin === 'ai_suggested' ? update(id, { origin: 'ai_confirmed' }) : checkIn;
}

/** Check-ins of local days `startDay..endDay` inclusive, oldest first. */
export async function listRange(startDay: DayKey, endDay: DayKey): Promise<CheckIn[]> {
  const checkIns = await db.checkins.where('day').between(startDay, endDay, true, true).filter(notDeleted).toArray();
  return checkIns.sort((a, b) => a.at.localeCompare(b.at));
}

export async function listByDay(day: DayKey): Promise<CheckIn[]> {
  return listRange(day, day);
}

/** The most recent check-in, if any. */
export async function latest(): Promise<CheckIn | undefined> {
  return db.checkins.orderBy('at').reverse().filter(notDeleted).first();
}

export async function getMany(ids: readonly ID[]): Promise<CheckIn[]> {
  return (await db.checkins.bulkGet([...ids])).filter(isLive);
}

export async function remove(id: ID): Promise<CheckIn> {
  return softDeleteRecord('checkins', id);
}

export async function restore(id: ID): Promise<CheckIn> {
  return restoreRecord('checkins', id);
}

export async function destroy(id: ID): Promise<void> {
  // A demo record never belonged to the user's history: no tombstone.
  if ((await db.checkins.get(id))?.isDemo) await db.checkins.delete(id);
  else await hardDelete('checkins', id);
}
