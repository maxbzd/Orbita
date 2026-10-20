import { addDays } from '../../domain/dates';
import { ITEM_KINDS } from '../../domain/types';
import type { Capture, DayKey, ID, Item, ItemKind } from '../../domain/types';
import { t } from '../../i18n';

/** The type chips of the stream, in display order ("Все" is the absence of a type). */
export const STREAM_TYPE_CHIPS: readonly ItemKind[] = ['decision', 'commitment', 'idea', 'prediction', 'task', 'question'];

export type PeriodFilter = 'all' | 'week' | 'month' | 'quarter';

export const PERIOD_OPTIONS: ReadonlyArray<{ value: PeriodFilter; label: string }> = [
  { value: 'all', get label() { return t('All time') } },
  { value: 'week', get label() { return t('7 days') } },
  { value: 'month', get label() { return t('30 days') } },
  { value: 'quarter', get label() { return t('90 days') } },
];

export interface StreamFilters {
  type?: ItemKind;
  personId?: ID;
  projectId?: ID;
  period: PeriodFilter;
}

export const NO_FILTERS: StreamFilters = { period: 'all' };

const PERIOD_DAYS: Record<Exclude<PeriodFilter, 'all'>, number> = { week: 7, month: 30, quarter: 90 };

/** First local day of the period, today included ("7 дней" = today and the six days before). */
export function periodFromDay(period: PeriodFilter, today: DayKey): DayKey | undefined {
  return period === 'all' ? undefined : addDays(today, -(PERIOD_DAYS[period] - 1));
}

const isPeriod = (value: string | null): value is PeriodFilter => value === 'all' || value === 'week' || value === 'month' || value === 'quarter';
const isKind = (value: string | null): value is ItemKind => ITEM_KINDS.some((kind) => kind === value);

/** Filters live in the address (`#/stream?type=idea&period=week`), so "back" restores them. */
export function parseFilters(params: URLSearchParams): StreamFilters {
  const type = params.get('type');
  const period = params.get('period');
  return {
    ...(isKind(type) && { type }),
    ...(params.get('person') && { personId: params.get('person') as ID }),
    ...(params.get('project') && { projectId: params.get('project') as ID }),
    period: isPeriod(period) ? period : 'all',
  };
}

export function filtersToParams(filters: StreamFilters, base: URLSearchParams = new URLSearchParams()): URLSearchParams {
  const params = new URLSearchParams(base);
  for (const key of ['type', 'person', 'project', 'period']) params.delete(key);
  if (filters.type) params.set('type', filters.type);
  if (filters.personId) params.set('person', filters.personId);
  if (filters.projectId) params.set('project', filters.projectId);
  if (filters.period !== 'all') params.set('period', filters.period);
  return params;
}

/** How many filters of the sheet are on (the type chip is shown on its own). */
export function countSheetFilters(filters: StreamFilters): number {
  return (filters.personId ? 1 : 0) + (filters.projectId ? 1 : 0) + (filters.period !== 'all' ? 1 : 0);
}

export const hasAnyFilter = (filters: StreamFilters): boolean => filters.type !== undefined || countSheetFilters(filters) > 0;

/** Objects of a record that still count: not trashed (the query already drops those) and not dismissed. */
export const isShownItem = (item: Item): boolean => item.status !== 'dismissed';

export type ItemsByCapture = ReadonlyMap<ID, readonly Item[]>;

export function groupItemsByCapture(items: readonly Item[]): Map<ID, Item[]> {
  const byCapture = new Map<ID, Item[]>();
  for (const item of items) {
    if (!item.captureId || !isShownItem(item)) continue;
    const list = byCapture.get(item.captureId);
    if (list) list.push(item);
    else byCapture.set(item.captureId, [item]);
  }
  for (const list of byCapture.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return byCapture;
}

/** Whether a record passes every filter of the stream. */
export function matchesFilters(capture: Capture, itemsByCapture: ItemsByCapture, filters: StreamFilters, today: DayKey): boolean {
  if (filters.personId && !capture.personIds.includes(filters.personId)) return false;
  if (filters.projectId && !capture.projectIds.includes(filters.projectId)) return false;
  const from = periodFromDay(filters.period, today);
  if (from && capture.day < from) return false;
  if (filters.type) {
    const items = itemsByCapture.get(capture.id) ?? [];
    if (!items.some((item) => item.kind === filters.type)) return false;
  }
  return true;
}
