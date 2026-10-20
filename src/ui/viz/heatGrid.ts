import { addDays, diffDays, startOfWeek, weekdayIndex } from '../../domain/dates';
import type { DayKey } from '../../domain/types';

export interface HeatCell {
  date: DayKey;
  /** Week column, 0-based from the week of `from`. */
  col: number;
  /** Row: 0 = Monday … 6 = Sunday. */
  row: number;
}

/** Cells of a Monday-first week grid from `from` to `to` inclusive. */
export function heatGrid(from: DayKey, to: DayKey): HeatCell[] {
  const total = diffDays(from, to) + 1;
  if (total <= 0) return [];
  const origin = startOfWeek(from);
  return Array.from({ length: total }, (_, i) => {
    const date = addDays(from, i);
    return { date, col: Math.floor(diffDays(origin, date) / 7), row: weekdayIndex(date) };
  });
}

export const HEAT_LEVELS = 4;

/** 0 for nothing, 1…4 for a growing share of `max`. */
export function heatLevel(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(HEAT_LEVELS, Math.max(1, Math.ceil((value / max) * HEAT_LEVELS)));
}

/** Month labels: the column where each month's first day (or the grid's first day) falls. */
export function monthLabels(cells: readonly HeatCell[]): Array<{ col: number; month: number }> {
  const out: Array<{ col: number; month: number }> = [];
  let lastMonth = -1;
  for (const cell of cells) {
    const month = Number(cell.date.slice(5, 7)) - 1;
    if (month !== lastMonth) {
      // A label too close to the previous one (under 3 columns) would overlap it: keep the later month.
      const previous = out[out.length - 1];
      if (previous && cell.col - previous.col < 3) out.pop();
      out.push({ col: cell.col, month });
      lastMonth = month;
    }
  }
  return out;
}
