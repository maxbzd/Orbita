import { addDays } from '../../domain/dates';
import type { DateInput } from '../../domain/dates';
import type { DayKey } from '../../domain/types';
import { demoId, hashString } from './random';
import { createClock } from './time';
import type { DemoClock } from './time';

/** How many days of history the demo covers by default. The authored story spans 59 days. */
export const DEFAULT_DEMO_DAYS = 60;
export const MAX_DEMO_DAYS = 365;

export interface SeedContext {
  clock: DemoClock;
  days: number;
  /** The oldest local day the demo data may touch. */
  firstDay: DayKey;
}

export function createContext(now: DateInput, days: number): SeedContext {
  if (!Number.isInteger(days) || days < 1 || days > MAX_DEMO_DAYS) {
    throw new RangeError(`The number of demo days must be an integer from 1 to ${MAX_DEMO_DAYS}`);
  }
  const clock = createClock(now);
  return { clock, days, firstDay: addDays(clock.today, -(days - 1)) };
}

/** Ids of the demo records, derived from the authoring keys. */
export const ids = {
  capture: (key: string) => demoId(`capture:${key}`),
  item: (key: string) => demoId(`item:${key}`),
  person: (key: string) => demoId(`person:${key}`),
  project: (key: string) => demoId(`project:${key}`),
  checkin: (key: string) => demoId(`checkin:${key}`),
  pattern: (key: string) => demoId(`pattern:${key}`),
  review: (key: string) => demoId(`review:${key}`),
  link: (key: string) => demoId(`link:${key}`),
};

/** A stable number in [0, 1) for a key: small per-record variation that does not depend on build order. */
export const unitFor = (key: string): number => hashString(key) / 4294967296;
