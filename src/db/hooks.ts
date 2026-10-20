import { useLiveQuery } from 'dexie-react-hooks';
import type {
  Capture,
  CheckIn,
  CommitmentDirection,
  DayKey,
  ID,
  ISODate,
  Item,
  ItemOfKind,
  ContextPackPreset,
  Pattern,
  PatternStatus,
  Person,
  Profile,
  Project,
  ProjectStatus,
  Review,
  ReviewPeriod,
  Settings,
} from '../domain/types';
import { findById } from './lookup';
import type { EntityRef } from './lookup';
import {
  capturesRepo,
  checkinsRepo,
  itemsRepo,
  patternsRepo,
  peopleRepo,
  presetsRepo,
  profileRepo,
  projectsRepo,
  reviewsRepo,
  usageRepo,
} from './repos';
import type { CaptureDayGroup, CaptureFilter } from './repos/captures';
import type { ItemFilter } from './repos/items';
import type { PeopleFilter } from './repos/people';
import type { UsageDay } from './repos/usage';
import { getSettings } from './settings';
import { listTrash } from './trash';
import type { TrashEntry } from './trash';

/**
 * Reactive queries for components (the only part of `db/` that depends on React).
 * Every hook returns `undefined` while the first result is loading and re-renders when the
 * underlying tables change. `null`/empty results mean "loaded, nothing there".
 * Filters are keyed by value, so passing a fresh object literal on every render is fine.
 *
 * Time-dependent queries (`until`, defaults to "now") are evaluated when the tables change,
 * not as the clock ticks: pass an explicit `until` and re-render when the day changes.
 */

const key = (value: unknown): string => JSON.stringify(value ?? null);

// ───────── Captures ─────────

/** Captures that need attention (unprocessed, in review, failed), newest first. */
export const useInbox = (): Capture[] | undefined => useLiveQuery(() => capturesRepo.listInbox(), []);

/** The stream: captures grouped by local day, newest day first. */
export const useFeed = (filter: CaptureFilter = {}): CaptureDayGroup[] | undefined =>
  useLiveQuery(() => capturesRepo.listFeed(filter), [key(filter)]);

export const useCapturesByDay = (day: DayKey): Capture[] | undefined =>
  useLiveQuery(() => capturesRepo.listByDay(day), [day]);

/** `null`: no such capture. */
export const useCapture = (id: ID | undefined): Capture | null | undefined =>
  useLiveQuery(async () => (id ? ((await capturesRepo.get(id)) ?? null) : null), [id]);

/** Number of captures per local day in `fromDay..toDay`. */
export const useCaptureCounts = (fromDay: DayKey, toDay: DayKey): Record<DayKey, number> | undefined =>
  useLiveQuery(() => capturesRepo.countsByDay(fromDay, toDay), [fromDay, toDay]);

// ───────── Items ─────────

export const useItems = (filter: ItemFilter = {}): Item[] | undefined =>
  useLiveQuery(() => itemsRepo.list(filter), [key(filter)]);

/** `null`: no such item. */
export const useItem = (id: ID | undefined): Item | null | undefined =>
  useLiveQuery(async () => (id ? ((await itemsRepo.get(id)) ?? null) : null), [id]);

/** Everything extracted from a capture, in extraction order. */
export const useCaptureItems = (captureId: ID | undefined): Item[] | undefined =>
  useLiveQuery(async () => (captureId ? itemsRepo.listByCapture(captureId) : []), [captureId]);

/** Items waiting for review (one capture, or all). */
export const useProposedItems = (captureId?: ID): Item[] | undefined =>
  useLiveQuery(() => itemsRepo.listProposed(captureId), [captureId]);

export const useProposedCount = (): number | undefined => useLiveQuery(() => itemsRepo.countProposed(), []);

/** Open commitments, nearest deadline first; one direction or both. */
export const useOpenCommitments = (direction?: CommitmentDirection): ItemOfKind<'commitment'>[] | undefined =>
  useLiveQuery(() => itemsRepo.listOpenCommitments(direction), [direction]);

/** Open predictions whose resolution date has come. */
export const usePredictionsToResolve = (until?: ISODate): ItemOfKind<'prediction'>[] | undefined =>
  useLiveQuery(() => itemsRepo.listPredictionsToResolve(until), [until]);

/** Decisions whose review date has come and that have no outcome yet. */
export const useDecisionsToReview = (until?: ISODate): ItemOfKind<'decision'>[] | undefined =>
  useLiveQuery(() => itemsRepo.listDecisionsToReview(until), [until]);

// ───────── People and projects ─────────

export const usePeople = (filter: PeopleFilter = {}): Person[] | undefined =>
  useLiveQuery(() => peopleRepo.list(filter), [key(filter)]);

/** `null`: no such person. */
export const usePerson = (id: ID | undefined): Person | null | undefined =>
  useLiveQuery(async () => (id ? ((await peopleRepo.get(id)) ?? null) : null), [id]);

export const useProjects = (status?: ProjectStatus): Project[] | undefined =>
  useLiveQuery(() => projectsRepo.list({ status }), [status]);

/** `null`: no such project. */
export const useProject = (id: ID | undefined): Project | null | undefined =>
  useLiveQuery(async () => (id ? ((await projectsRepo.get(id)) ?? null) : null), [id]);

// ───────── Check-ins, patterns, reviews ─────────

/** Check-ins of local days `startDay..endDay`, oldest first. */
export const useCheckIns = (startDay: DayKey, endDay: DayKey): CheckIn[] | undefined =>
  useLiveQuery(() => checkinsRepo.listRange(startDay, endDay), [startDay, endDay]);

/** `null`: no check-ins yet. */
export const useLatestCheckIn = (): CheckIn | null | undefined =>
  useLiveQuery(async () => (await checkinsRepo.latest()) ?? null, []);

export const usePatterns = (status?: PatternStatus): Pattern[] | undefined =>
  useLiveQuery(() => patternsRepo.list({ status }), [status]);

export const useReviews = (period?: ReviewPeriod): Review[] | undefined =>
  useLiveQuery(() => reviewsRepo.list({ period }), [period]);

// ───────── Lookup, settings, system ─────────

/** Any entity by id (captures, items, people, projects, check-ins, patterns, reviews); `null` if there is none. */
export const useEntity = (id: ID | undefined): EntityRef | null | undefined =>
  useLiveQuery(async () => (id ? ((await findById(id)) ?? null) : null), [id]);

/** Settings with defaults for everything never saved. */
export const useSettings = (): Settings | undefined => useLiveQuery(() => getSettings(), []);

/** The profile ("кто я"); empty fields until the user fills it in. */
export const useProfile = (): Profile | undefined => useLiveQuery(() => profileRepo.get(), []);

/** Token and cost totals per local day. */
export const useUsageSummary = (startDay: DayKey, endDay: DayKey): UsageDay[] | undefined =>
  useLiveQuery(() => usageRepo.summaryByDay(startDay, endDay), [startDay, endDay]);

/** Saved context-pack presets (the user's own), by name. */
export const usePresets = (): ContextPackPreset[] | undefined => useLiveQuery(() => presetsRepo.list(), []);

export const useTrash = (): TrashEntry[] | undefined => useLiveQuery(() => listTrash(), []);
