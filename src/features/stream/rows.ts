import type { CaptureDayGroup } from '../../db/repos/captures';
import type { Capture, DayKey } from '../../domain/types';
import { DAY_PART_LABELS, dayHeading, dayPartOf } from './dayparts';
import type { DayHeading, DayPart } from './dayparts';

/** One line of the flattened stream: what the list renders (and, from 200 lines on, virtualizes). */
export type StreamRow =
  | { type: 'day'; key: string; day: DayKey; heading: DayHeading; count: number }
  | { type: 'part'; key: string; day: DayKey; part: DayPart; label: string }
  | { type: 'capture'; key: string; capture: Capture };

/** Above this many lines the list renders only what is near the viewport. */
export const VIRTUALIZE_FROM = 200;

/**
 * Day groups → flat rows: a day heading, then for each stretch of the day (Утро / День / Вечер) a small
 * label followed by its records. Groups arrive newest first and stay in that order, so a part
 * is simply a run of neighbouring records.
 */
export function buildStreamRows(groups: readonly CaptureDayGroup[], today?: DayKey, timeZone?: string): StreamRow[] {
  const rows: StreamRow[] = [];
  for (const group of groups) {
    if (group.captures.length === 0) continue;
    rows.push({ type: 'day', key: `day:${group.day}`, day: group.day, heading: dayHeading(group.day, today), count: group.captures.length });
    let previous: DayPart | undefined;
    for (const capture of group.captures) {
      const part = dayPartOf(capture.createdAt, timeZone);
      if (part !== previous) {
        rows.push({ type: 'part', key: `part:${group.day}:${part}`, day: group.day, part, label: DAY_PART_LABELS[part] });
        previous = part;
      }
      rows.push({ type: 'capture', key: `cap:${capture.id}`, capture });
    }
  }
  return rows;
}

/** Rough heights used before a row is measured (px), so the scrollbar does not jump. */
export function estimateRowHeight(row: StreamRow): number {
  switch (row.type) {
    case 'day':
      return 56;
    case 'part':
      return 28;
    case 'capture':
      return 112;
  }
}
