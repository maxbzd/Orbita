import { capturesRepo, checkinsRepo, itemsRepo, patternsRepo } from '../../db';
import { periodRange } from '../../domain/dates';
import type { Capture, CheckIn, DayKey, Item, ItemOfKind, Pattern } from '../../domain/types';
import { recordDaysCount, stripDays, trendPeriod } from './model';
import type { TimeView } from './model';

/** Everything «Время» reads, loaded in one go so a new record redraws the whole picture at once. */
export interface TimeSnapshot {
  view: TimeView;
  day: DayKey;
  /** First and last day covered by `captures` and `checkIns`: the shown period, the trend period and the day strip. */
  fromDay: DayKey;
  toDay: DayKey;
  captures: Capture[];
  checkIns: CheckIn[];
  /** Objects extracted from the records of the selected day. */
  dayItems: Item[];
  /** Commitments that are open or done (not proposed, not dismissed). */
  commitments: ItemOfKind<'commitment'>[];
  patterns: Pattern[];
  /** Days with at least one record, over all time. */
  recordDays: number;
}

export async function loadTimeSnapshot(view: TimeView, day: DayKey): Promise<TimeSnapshot> {
  const shown = periodRange(view, day);
  const trend = periodRange(trendPeriod(view), day);
  const strip = stripDays(day);
  const starts = [shown.startDay, trend.startDay, strip[0]!];
  const ends = [shown.endDay, trend.endDay, strip[strip.length - 1]!];
  const fromDay = starts.reduce((a, b) => (a < b ? a : b));
  const toDay = ends.reduce((a, b) => (a > b ? a : b));

  const [captures, checkIns, commitments, patterns, everything] = await Promise.all([
    capturesRepo.list({ fromDay, toDay }),
    checkinsRepo.listRange(fromDay, toDay),
    itemsRepo.listByKind('commitment'),
    patternsRepo.list(),
    capturesRepo.list(),
  ]);
  const dayCaptures = captures.filter((capture) => capture.day === day);
  const dayItems = (await Promise.all(dayCaptures.map((capture) => itemsRepo.listByCapture(capture.id)))).flat();

  return {
    view,
    day,
    fromDay,
    toDay,
    captures,
    checkIns,
    dayItems,
    commitments: commitments.filter((item) => item.status === 'active' || item.status === 'done'),
    patterns: patterns.filter((pattern) => pattern.status !== 'rejected'),
    recordDays: recordDaysCount(everything),
  };
}
