import Dexie from 'dexie';
import { localDayKey, nowISO } from '../../domain/dates';
import { newId } from '../../domain/ids';
import type { Capture, CaptureKind, DayKey, ID, ProcessStatus } from '../../domain/types';
import {
  NotFoundError,
  allTables,
  byCreatedDesc,
  hardDelete,
  isLive,
  notDeleted,
  patchRecord,
  restoreRecord,
  softDeleteRecord,
} from '../internal';
import { db } from '../schema';
import * as items from './items';
import * as links from './links';
import { recomputeMentions } from './people';
import { t } from '../../i18n';

type Managed = 'updatedAt' | 'deletedAt';

/**
 * Only `kind` is required. Defaults: `createdAt` now, `day` the local day of `createdAt`, empty lists,
 * `status` `transcribed` when there is text (typed or dictated) and `raw` when there is none yet.
 */
export type NewCapture = Pick<Capture, 'kind'> & Partial<Omit<Capture, 'kind' | Managed>>;
export type CapturePatch = Partial<Omit<Capture, 'id' | 'createdAt' | Managed>>;

/** Statuses of captures that still need attention: the stream shows them first. */
export const INBOX_STATUSES: readonly ProcessStatus[] = ['raw', 'transcribing', 'transcribed', 'extracting', 'review', 'failed'];

export interface CaptureFilter {
  fromDay?: DayKey;
  toDay?: DayKey;
  personId?: ID;
  projectId?: ID;
  tag?: string;
  kind?: CaptureKind;
  statuses?: readonly ProcessStatus[];
  limit?: number;
}

export interface CaptureDayGroup {
  day: DayKey;
  /** Newest first. */
  captures: Capture[];
}

export async function create(input: NewCapture): Promise<Capture> {
  const createdAt = input.createdAt ?? nowISO();
  const text = input.text ?? '';
  const capture: Capture = {
    ...input,
    id: input.id ?? newId(),
    createdAt,
    updatedAt: createdAt,
    day: input.day ?? localDayKey(createdAt),
    text,
    projectIds: input.projectIds ?? [],
    personIds: input.personIds ?? [],
    tags: input.tags ?? [],
    status: input.status ?? (text.trim() === '' ? 'raw' : 'transcribed'),
  };
  await db.transaction('rw', db.captures, db.people, async () => {
    await db.captures.add(capture);
    await recomputeMentions(capture.personIds);
  });
  return capture;
}

export async function get(id: ID): Promise<Capture | undefined> {
  return db.captures.get(id);
}

export async function getMany(ids: readonly ID[]): Promise<Capture[]> {
  return (await db.captures.bulkGet([...ids])).filter(isLive);
}

/** Invariant 4: a change of `personIds` refreshes the mention counters of everyone affected. */
export async function update(id: ID, patch: CapturePatch): Promise<Capture> {
  return db.transaction('rw', db.captures, db.people, async () => {
    const before = await db.captures.get(id);
    if (!before) throw new NotFoundError('captures', id);
    const next = await patchRecord('captures', id, patch);
    if (patch.personIds !== undefined) await recomputeMentions([...before.personIds, ...next.personIds]);
    return next;
  });
}

/** Moves a capture along the processing pipeline; `error` is kept for a retry only with `failed`. */
export async function setStatus(id: ID, status: ProcessStatus, { error }: { error?: string } = {}): Promise<Capture> {
  return update(id, {
    status,
    error: status === 'failed' ? (error ?? t('Could not process the recording')) : undefined,
    ...((status === 'review' || status === 'done') && { processedAt: nowISO() }),
  });
}

export const markFailed = (id: ID, message: string): Promise<Capture> => setStatus(id, 'failed', { error: message });

// ───────── Deletion ─────────

/**
 * Moves a capture to the trash. Accepted items stay (invariant 3); items still waiting for review
 * are dismissed, since there is nothing left to review them against.
 */
export async function remove(id: ID): Promise<Capture> {
  return db.transaction('rw', db.captures, db.items, db.people, async () => {
    const capture = await softDeleteRecord('captures', id);
    // Stamped with the capture's own deletion time, so `restore` can tell these from items dismissed earlier.
    const now = capture.deletedAt ?? nowISO();
    await db.items
      .where('captureId')
      .equals(id)
      .filter((item) => item.status === 'proposed' && notDeleted(item))
      .modify({ status: 'dismissed', updatedAt: now });
    await recomputeMentions(capture.personIds);
    return capture;
  });
}

/** Takes a capture out of the trash. Items `remove` dismissed with it go back to review; ones dismissed earlier stay. */
export async function restore(id: ID): Promise<Capture> {
  return db.transaction('rw', db.captures, db.items, db.people, async () => {
    const deletedAt = (await db.captures.get(id))?.deletedAt;
    const capture = await restoreRecord('captures', id);
    if (deletedAt) {
      await db.items
        .where('captureId')
        .equals(id)
        .filter((item) => item.status === 'dismissed' && item.updatedAt === deletedAt)
        .modify({ status: 'proposed', updatedAt: nowISO() });
    }
    await recomputeMentions(capture.personIds);
    return capture;
  });
}

/**
 * Deletes a capture for good (trash purge): its audio and chunks go too. Accepted items lose the
 * link and are flagged `sourceDeleted` (invariant 3); proposed and dismissed ones are deleted.
 * Check-ins only forget the link.
 */
export async function destroy(id: ID): Promise<void> {
  await db.transaction('rw', allTables(), async () => {
    const capture = await db.captures.get(id);
    await db.audio.where('captureId').equals(id).delete();
    await db.chunks.where('captureId').equals(id).delete();

    const now = nowISO();
    for (const item of await db.items.where('captureId').equals(id).toArray()) {
      if (item.status === 'proposed' || item.status === 'dismissed') {
        await items.destroy(item.id);
        continue;
      }
      const { captureId: _detached, ...rest } = item;
      await db.items.put({ ...rest, sourceDeleted: true, updatedAt: now } as typeof item);
    }
    await db.checkins
      .filter((checkIn) => checkIn.captureId === id)
      .modify((checkIn) => {
        delete checkIn.captureId;
      });

    await links.removeFor(id);
    await hardDelete('captures', id);
    if (capture) await recomputeMentions(capture.personIds);
  });
}

// ───────── Queries ─────────

/** Captures that still need attention (see `INBOX_STATUSES`), newest first. */
export async function listInbox(): Promise<Capture[]> {
  const captures = await db.captures
    .where('status')
    .anyOf([...INBOX_STATUSES])
    .filter(notDeleted)
    .toArray();
  return captures.sort(byCreatedDesc);
}

export async function listByDay(day: DayKey): Promise<Capture[]> {
  const captures = await db.captures.where('day').equals(day).filter(notDeleted).toArray();
  return captures.sort(byCreatedDesc);
}

function matchesFilter(capture: Capture, filter: CaptureFilter): boolean {
  return (
    notDeleted(capture) &&
    (!filter.kind || capture.kind === filter.kind) &&
    (!filter.statuses || filter.statuses.includes(capture.status)) &&
    (!filter.personId || capture.personIds.includes(filter.personId)) &&
    (!filter.projectId || capture.projectIds.includes(filter.projectId)) &&
    (!filter.tag || capture.tags.includes(filter.tag))
  );
}

/** Captures matching the filter, newest first. */
export async function list(filter: CaptureFilter = {}): Promise<Capture[]> {
  const byDay = filter.fromDay !== undefined || filter.toDay !== undefined;
  const source = byDay
    ? db.captures.where('day').between(filter.fromDay ?? Dexie.minKey, filter.toDay ?? Dexie.maxKey, true, true)
    : db.captures.orderBy('createdAt').reverse();

  let matching = source.filter((capture) => matchesFilter(capture, filter));
  if (!byDay && filter.limit !== undefined) matching = matching.limit(filter.limit);
  const captures = (await matching.toArray()).sort((a, b) => b.day.localeCompare(a.day) || byCreatedDesc(a, b));
  return byDay && filter.limit !== undefined ? captures.slice(0, filter.limit) : captures;
}

/** The stream: matching captures grouped by local day, newest day first. */
export async function listFeed(filter: CaptureFilter = {}): Promise<CaptureDayGroup[]> {
  const groups: CaptureDayGroup[] = [];
  for (const capture of await list(filter)) {
    const last = groups[groups.length - 1];
    if (last?.day === capture.day) last.captures.push(capture);
    else groups.push({ day: capture.day, captures: [capture] });
  }
  return groups;
}

/** Number of captures per local day in `fromDay..toDay` (days without captures are absent). */
export async function countsByDay(fromDay: DayKey, toDay: DayKey): Promise<Record<DayKey, number>> {
  const counts: Record<DayKey, number> = {};
  await db.captures
    .where('day')
    .between(fromDay, toDay, true, true)
    .filter(notDeleted)
    .each((capture) => {
      counts[capture.day] = (counts[capture.day] ?? 0) + 1;
    });
  return counts;
}
