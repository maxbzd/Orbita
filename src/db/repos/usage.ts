import { dayRangeToISO, localDayKey, nowISO } from '../../domain/dates';
import { newId } from '../../domain/ids';
import type { DayKey, ISODate, UsageRow } from '../../domain/types';
import { db } from '../schema';

/** `id` and `at` are filled in when omitted. */
export type NewUsage = Omit<UsageRow, 'id' | 'at'> & Partial<Pick<UsageRow, 'id' | 'at'>>;

export interface UsageDay {
  day: DayKey;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  audioSec: number;
  costUsd: number;
}

/** Records one provider call (the AI layer does this after every request). */
export async function record(input: NewUsage): Promise<UsageRow> {
  const row: UsageRow = { ...input, id: input.id ?? newId(), at: input.at ?? nowISO() };
  await db.usage.add(row);
  return row;
}

/** Rows with `from <= at < to`, oldest first. */
export async function listRange(from: ISODate, to: ISODate): Promise<UsageRow[]> {
  return db.usage.where('at').between(from, to, true, false).toArray();
}

/** Totals per local day for `startDay..endDay` inclusive; days without calls are left out. */
export async function summaryByDay(startDay: DayKey, endDay: DayKey, timeZone?: string): Promise<UsageDay[]> {
  const { from, to } = dayRangeToISO(startDay, endDay, timeZone);
  const days = new Map<DayKey, UsageDay>();
  for (const row of await listRange(from, to)) {
    const day = localDayKey(row.at, timeZone);
    const total = days.get(day) ?? { day, calls: 0, inputTokens: 0, outputTokens: 0, audioSec: 0, costUsd: 0 };
    total.calls += 1;
    total.inputTokens += row.inputTokens;
    total.outputTokens += row.outputTokens;
    total.audioSec += row.audioSec ?? 0;
    total.costUsd += row.costUsd ?? 0;
    days.set(day, total);
  }
  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export async function clear(): Promise<void> {
  await db.usage.clear();
}
