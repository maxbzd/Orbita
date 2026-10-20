import { useEffect, useMemo, useState } from 'react';
import { useCheckIns, useFeed, useInbox, useItems, usePeople, useProjects } from '../../db/hooks';
import type { CaptureDayGroup } from '../../db/repos/captures';
import { localDayKey } from '../../domain/dates';
import type { Capture, DayKey, ID, Person, Project } from '../../domain/types';
import { groupItemsByCapture, matchesFilters, periodFromDay } from './filters';
import type { ItemsByCapture, StreamFilters } from './filters';
import { isInboxStatus } from './rowModel';

/** The local day, refreshed when the tab comes back (a stream left open overnight must not stay on yesterday). */
export function useToday(): DayKey {
  const [today, setToday] = useState(() => localDayKey());
  useEffect(() => {
    const refresh = (): void => setToday(localDayKey());
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return today;
}

/** Mood of the check-in written next to a record (−1…+1), by capture id. For the 28 px flower in a row. */
export function useMoodByCapture(): ReadonlyMap<ID, number> {
  const checkIns = useCheckIns('0000-01-01', '9999-12-31');
  return useMemo(() => {
    const byCapture = new Map<ID, { at: string; valence: number }>();
    for (const checkIn of checkIns ?? []) {
      if (!checkIn.captureId) continue;
      const known = byCapture.get(checkIn.captureId);
      if (!known || checkIn.at > known.at) byCapture.set(checkIn.captureId, { at: checkIn.at, valence: checkIn.valence });
    }
    return new Map([...byCapture].map(([id, { valence }]) => [id, valence]));
  }, [checkIns]);
}

/** Objects extracted from each record (dismissed ones left out), by capture id. */
export function useItemsByCapture(): ItemsByCapture | undefined {
  const items = useItems();
  return useMemo(() => (items ? groupItemsByCapture(items) : undefined), [items]);
}

export interface StreamData {
  loading: boolean;
  /** Records that need attention, newest first, with the filters applied. */
  inbox: Capture[];
  /** Everything else grouped by day, newest first. */
  groups: CaptureDayGroup[];
  itemsByCapture: ItemsByCapture;
  moodByCapture: ReadonlyMap<ID, number>;
  people: Person[];
  projects: Project[];
  /** There may be older records than the `limit` loaded so far. */
  hasMore: boolean;
  /** Records in the database that match the day/person/project filters (inbox included), before the type filter. */
  empty: boolean;
}

const NO_ITEMS: ItemsByCapture = new Map();

/** Everything the stream shows, from the reactive queries; the type filter is applied here, on the objects found. */
export function useStreamData(filters: StreamFilters, limit: number): StreamData {
  const today = useToday();
  const feed = useFeed({
    fromDay: periodFromDay(filters.period, today),
    personId: filters.personId,
    projectId: filters.projectId,
    limit,
  });
  const inboxAll = useInbox();
  const itemsByCapture = useItemsByCapture();
  const moodByCapture = useMoodByCapture();
  const people = usePeople();
  const projects = useProjects();

  return useMemo<StreamData>(() => {
    const items = itemsByCapture ?? NO_ITEMS;
    const loading = feed === undefined || inboxAll === undefined || itemsByCapture === undefined;
    const fetched = (feed ?? []).reduce((sum, group) => sum + group.captures.length, 0);

    const passes = (capture: Capture): boolean => matchesFilters(capture, items, filters, today);
    const inbox = (inboxAll ?? []).filter(passes);
    const groups = (feed ?? [])
      .map((group) => ({ day: group.day, captures: group.captures.filter((capture) => !isInboxStatus(capture.status) && passes(capture)) }))
      .filter((group) => group.captures.length > 0);

    return {
      loading,
      inbox,
      groups,
      itemsByCapture: items,
      moodByCapture,
      people: people ?? [],
      projects: projects ?? [],
      hasMore: fetched >= limit,
      empty: !loading && inbox.length === 0 && groups.length === 0,
    };
  }, [feed, inboxAll, itemsByCapture, moodByCapture, people, projects, filters, limit, today]);
}
