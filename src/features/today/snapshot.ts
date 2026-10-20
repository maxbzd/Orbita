import { capturesRepo, checkinsRepo, itemsRepo, patternsRepo, peopleRepo, reviewsRepo } from '../../db';
import { addDays, startOfDayInstant } from '../../domain/dates';
import type { Capture, CheckIn, DayKey, ID, Item, ItemOfKind, Pattern, Review } from '../../domain/types';

/** Records needed before patterns can appear ("Паттерны появятся после 14 записей"). */
export const PATTERN_THRESHOLD = 14;

/** Everything "Сегодня" reads from the database, loaded in one go. */
export interface TodaySnapshot {
  day: DayKey;
  /** Records of the day, newest first. */
  captures: Capture[];
  /** What was extracted from today's records (dismissed items left out). */
  items: Item[];
  /** Today's check-ins, oldest first. */
  checkIns: CheckIn[];
  /** All open commitments, nearest deadline first. */
  commitments: ItemOfKind<'commitment'>[];
  /** Open predictions whose resolution date has come. */
  predictions: ItemOfKind<'prediction'>[];
  /** Decisions whose review date has come. */
  decisions: ItemOfKind<'decision'>[];
  /** Names of the people the above refer to. */
  peopleNames: Record<ID, string>;
  /** The newest candidate or confirmed pattern. */
  pattern: Pattern | null;
  /** The newest weekly/monthly/yearly review (or a daily one when there is no other). */
  review: Review | null;
  /** The review of this very day, once it was closed. */
  dayReview: Review | null;
  /** How many records exist overall, capped at `PATTERN_THRESHOLD`. */
  recordsTotal: number;
}

/** The last instant of a local day: "due today" means `dueAt <= endOfDay`. */
export function endOfDayISO(day: DayKey): string {
  return new Date(startOfDayInstant(addDays(day, 1)).getTime() - 1).toISOString();
}

/** Reads the day from the repositories. Subscribing to it with `useLiveQuery` makes the screen reactive. */
export async function loadTodaySnapshot(day: DayKey): Promise<TodaySnapshot> {
  const until = endOfDayISO(day);
  const [captures, checkIns, commitments, predictions, decisions, patterns, reviews, recent, people] = await Promise.all([
    capturesRepo.listByDay(day),
    checkinsRepo.listByDay(day),
    itemsRepo.listOpenCommitments(),
    itemsRepo.listPredictionsToResolve(until),
    itemsRepo.listDecisionsToReview(until),
    patternsRepo.list(),
    reviewsRepo.list(),
    capturesRepo.list({ limit: PATTERN_THRESHOLD }),
    peopleRepo.list({ includeArchived: true }),
  ]);
  const items = (await Promise.all(captures.map((capture) => itemsRepo.listByCapture(capture.id)))).flat().filter((item) => item.status !== 'dismissed');

  const peopleNames: Record<ID, string> = {};
  for (const person of people) peopleNames[person.id] = person.name;

  return {
    day,
    captures,
    items,
    checkIns,
    commitments,
    predictions,
    decisions,
    peopleNames,
    pattern: patterns.find((pattern) => pattern.status === 'confirmed' || pattern.status === 'candidate') ?? null,
    review: reviews.find((review) => review.period !== 'day') ?? reviews[0] ?? null,
    dayReview: reviews.find((review) => review.period === 'day' && review.startDay === day) ?? null,
    recordsTotal: recent.length,
  };
}
