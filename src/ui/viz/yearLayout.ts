import { addMonths } from '../../domain/dates';
import type { DayKey } from '../../domain/types';
import { monthGridCell } from './calendar';

/** Geometry of the year sky: 12 mini-months in a 3 × 4 grid inside a 300 × 416 box. */
export const YEAR_VIEW_W = 300;
export const YEAR_VIEW_H = 416;
export const YEAR_PAD = 12;
export const YEAR_CELL = 12;
export const YEAR_MONTH_W = YEAR_CELL * 7;
export const YEAR_TITLE_H = 20;
export const YEAR_MONTH_H = YEAR_TITLE_H + YEAR_CELL * 6;
export const YEAR_GAP_X = 12;
export const YEAR_GAP_Y = 8;

/** Top-left corner of month `m` (0 = January). */
export function monthOrigin(m: number): { x: number; y: number } {
  return {
    x: YEAR_PAD + (m % 3) * (YEAR_MONTH_W + YEAR_GAP_X),
    y: YEAR_PAD + Math.floor(m / 3) * (YEAR_MONTH_H + YEAR_GAP_Y),
  };
}

/** Centre of a day's cell in the year figure. */
export function yearCellCenter(date: DayKey): { x: number; y: number } {
  const m = Number(date.slice(5, 7)) - 1;
  const origin = monthOrigin(m);
  const { col, row } = monthGridCell(date);
  return { x: origin.x + col * YEAR_CELL + YEAR_CELL / 2, y: origin.y + YEAR_TITLE_H + row * YEAR_CELL + YEAR_CELL / 2 };
}

/** Where a key lands after PageUp / PageDown: the same day a month away, clamped to the list. */
export function shiftMonthIndex(keys: readonly DayKey[], index: number, months: number): number {
  const key = keys[index];
  if (!key) return index;
  const target = addMonths(key, months);
  const found = keys.indexOf(target);
  if (found >= 0) return found;
  return months > 0 ? keys.length - 1 : 0;
}
