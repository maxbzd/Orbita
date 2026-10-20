import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { reviewsRepo } from '../../db';
import { useCaptureCounts, useCheckIns } from '../../db/hooks';
import { addDays, diffDays, formatMonthName, localDayKey, shiftPeriod } from '../../domain/dates';
import type { DayKey, ID, Review } from '../../domain/types';
import { aiReadyForReviews } from './actions';
import type { MonthCompare, SlideContext } from './model';

/** `undefined` while loading, `null` when there is no such (or a deleted) review. */
export function useReviewById(id: ID | undefined): Review | null | undefined {
  return useLiveQuery(async () => {
    const review = id ? await reviewsRepo.get(id) : undefined;
    return review && !review.deletedAt ? review : null;
  }, [id]);
}

/** Whether a new review would get the model's voice. `undefined` while loading. */
export function useAiReadyForReviews(): boolean | undefined {
  return useLiveQuery(() => aiReadyForReviews(), []);
}

const sumTo = (counts: Record<DayKey, number>, from: DayKey, to: DayKey): number => {
  let total = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) total += counts[day] ?? 0;
  return total;
};

/** The ranges the month comparison counts: this month and the previous one, up to the same day of the month. */
export function monthCompareRanges(startDay: DayKey, endDay: DayKey, today: DayKey) {
  const last = Math.max(1, diffDays(startDay, endDay) + 1);
  const dayOfMonth = today >= startDay && today <= endDay ? diffDays(startDay, today) + 1 : last;
  const previous = shiftPeriod('month', startDay, -1);
  const previousLast = Math.max(1, diffDays(previous.startDay, previous.endDay) + 1);
  const sameDay = Math.min(dayOfMonth, previousLast);
  return {
    dayOfMonth,
    full: dayOfMonth >= last,
    now: { from: startDay, to: addDays(startDay, dayOfMonth - 1) },
    before: { from: previous.startDay, to: addDays(previous.startDay, sameDay - 1) },
    previousMonth: formatMonthName(previous.startDay),
  };
}

/** The data the slides need besides the review itself: moods of the month, the ticket's two moods, the month comparison. */
export function useSlideContext(review: Review | null | undefined): SlideContext | undefined {
  const today = useMemo(() => localDayKey(), []);
  const period = review?.period;
  const startDay = review?.startDay ?? today;
  const endDay = review?.endDay ?? today;
  const wantsMoods = period === 'day' || period === 'month';
  const moods = useCheckIns(startDay, wantsMoods ? endDay : startDay);
  const ranges = useMemo(() => monthCompareRanges(startDay, endDay, today), [startDay, endDay, today]);
  const wantsCompare = period === 'month';
  const nowCounts = useCaptureCounts(ranges.now.from, wantsCompare ? ranges.now.to : ranges.now.from);
  const beforeCounts = useCaptureCounts(ranges.before.from, wantsCompare ? ranges.before.to : ranges.before.from);

  return useMemo(() => {
    if (!review || !moods || !nowCounts || !beforeCounts) return undefined;
    const context: SlideContext = { today };
    if (period === 'day') {
      const sorted = [...moods].sort((a, b) => a.at.localeCompare(b.at));
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      context.dayMood = { from: first ? first.valence * 3 : null, to: last && last !== first ? last.valence * 3 : null };
    }
    if (period === 'month') {
      const days = Math.max(1, diffDays(startDay, endDay) + 1);
      const byDay = new Map<DayKey, number[]>();
      for (const checkIn of moods) byDay.set(checkIn.day, [...(byDay.get(checkIn.day) ?? []), checkIn.valence * 3]);
      context.monthMoods = Array.from({ length: days }, (_, i) => {
        const values = byDay.get(addDays(startDay, i));
        return values ? values.reduce((a, b) => a + b, 0) / values.length : null;
      });
      const compare: MonthCompare = {
        dayOfMonth: ranges.dayOfMonth,
        now: sumTo(nowCounts, ranges.now.from, ranges.now.to),
        before: sumTo(beforeCounts, ranges.before.from, ranges.before.to),
        beforeMonth: ranges.previousMonth,
        full: ranges.full,
      };
      context.compare = compare;
    }
    return context;
  }, [review, moods, nowCounts, beforeCounts, today, period, startDay, endDay, ranges]);
}
