import { capturesRepo, checkinsRepo, itemsRepo, patternsRepo, peopleRepo, profileRepo, reviewsRepo } from '../db';
import { brierScore, calibrationReport, toForecasts } from '../domain/calibration';
import type { CalibrationReport } from '../domain/calibration';
import {
  dayRangeToISO,
  diffDays,
  formatDayWithWeekday,
  localDayKey,
  periodRange,
  startOfDayInstant,
  addDays,
} from '../domain/dates';
import { isHiddenFromAi } from '../domain/hidden';
import { checkinsCount, daysCount, itemKindCount, mentionsCount, predictionsCount, recordsCount, timesCount, wordsCount } from '../domain/counts';
import { countWords, truncate } from '../domain/text';
import type {
  CheckIn,
  CommitmentDirection,
  DayKey,
  ID,
  Item,
  ItemKind,
  PatternKind,
  PatternStatus,
  PersonRole,
  Review,
  ReviewPeriod,
  ReviewSection,
} from '../domain/types';
import { describeError, isAbortedError } from './errors';
import { buildReviewSystem, buildReviewUser } from './prompts/review';
import { ReviewSchema, SCHEMA_NAMES, reviewJsonSchema } from './prompts/schemas';
import type { LlmProvider, Usage } from './providers/types';
import { t } from '../i18n';

/**
 * Reviews of a day, week, month or year. The numbers and lists are always computed by rules from the
 * database (`buildReviewDigest`) and turned into sections without any model. With a provider the same
 * digest is also given to the model, which adds a headline, a few written sections and questions;
 * without a key — or when the model fails — the review is rules only, never empty.
 */

// ───────── The digest ─────────

export interface DigestEntry {
  id: ID;
  kind: ItemKind;
  title: string;
  /** Local day of the event (done, resolved, due). */
  day?: DayKey;
  person?: string;
  direction?: CommitmentDirection;
  daysOverdue?: number;
}

export interface DigestPattern {
  id: ID;
  title: string;
  kind: PatternKind;
  status: PatternStatus;
  confidence: number;
  occurrences: number;
}

export interface DigestPerson {
  id: ID;
  name: string;
  role: PersonRole;
  mentions: number;
  /** −1..1, how things stand with the person; absent when unknown. */
  relationMood?: number;
  openIOwe: number;
  openOwedToMe: number;
}

export interface DigestMood {
  checkins: number;
  /** Averages over the period. */
  valence: number;
  energy: number;
  stress?: number;
  bestDay: DayKey;
  hardestDay: DayKey;
  trend: 'up' | 'down' | 'flat' | 'unknown';
  /** One point per day with a check-in. */
  byDay: { day: DayKey; valence: number; energy: number }[];
}

export interface DigestCalibration {
  /** All closed predictions, not only this period's. */
  overall: CalibrationReport;
  closedInPeriod: number;
  brierInPeriod?: number;
}

export interface DigestStats {
  captures: number;
  /** Days with at least one record, and days of the period that have passed. */
  activeDays: number;
  days: number;
  words: number;
  voiceMinutes: number;
  checkins: number;
  /** Objects made in the period (accepted ones; proposals and dismissed are not counted). */
  itemsCreated: Partial<Record<ItemKind, number>>;
  itemsCreatedTotal: number;
  done: number;
  overdue: number;
  openIOwe: number;
  openOwedToMe: number;
}

export interface ReviewDigest {
  period: ReviewPeriod;
  startDay: DayKey;
  endDay: DayKey;
  stats: DigestStats;
  wins: DigestEntry[];
  overdue: DigestEntry[];
  decisions: DigestEntry[];
  patterns: DigestPattern[];
  people: DigestPerson[];
  themes: { tag: string; count: number }[];
  calibration: DigestCalibration;
  mood: DigestMood | null;
}

const MAX_WINS = 8;
const MAX_OVERDUE = 8;
const MAX_DECISIONS = 6;
const MAX_PEOPLE = 5;
const MAX_THEMES = 5;
const MAX_PATTERNS = 5;
/** A closed prediction counts as a good call when it leaned the right way. */
const LEAN_THRESHOLD = 0.6;
const GOOD_OUTCOME_RATING = 4;
const MIN_CHECKINS_FOR_TREND = 4;
const TREND_THRESHOLD = 0.2;

/** Kinds that have a deadline someone is waiting on; a prediction or decision with an outcome is closed. */
function isAwaitingAction(item: Item): boolean {
  switch (item.kind) {
    case 'commitment':
    case 'task':
      return true;
    case 'prediction':
    case 'decision':
      return item.outcome === undefined;
    default:
      return false;
  }
}

const average = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const round = (value: number, digits = 2): number => Math.round(value * 10 ** digits) / 10 ** digits;

function moodDigest(checkIns: readonly CheckIn[]): DigestMood | null {
  if (checkIns.length === 0) return null;
  const days = new Map<DayKey, CheckIn[]>();
  for (const checkIn of checkIns) days.set(checkIn.day, [...(days.get(checkIn.day) ?? []), checkIn]);
  const byDay = [...days.entries()]
    .map(([day, entries]) => ({ day, valence: round(average(entries.map((entry) => entry.valence))), energy: round(average(entries.map((entry) => entry.energy))) }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const best = byDay.reduce((top, point) => (point.valence > top.valence ? point : top));
  const hardest = byDay.reduce((low, point) => (point.valence < low.valence ? point : low));
  const stress = checkIns.flatMap((entry) => (typeof entry.stress === 'number' ? [entry.stress] : []));

  let trend: DigestMood['trend'] = 'unknown';
  if (checkIns.length >= MIN_CHECKINS_FOR_TREND && byDay.length >= 2) {
    const middle = Math.ceil(byDay.length / 2);
    const change = average(byDay.slice(middle).map((point) => point.valence)) - average(byDay.slice(0, middle).map((point) => point.valence));
    trend = change > TREND_THRESHOLD ? 'up' : change < -TREND_THRESHOLD ? 'down' : 'flat';
  }
  return {
    checkins: checkIns.length,
    valence: round(average(checkIns.map((entry) => entry.valence))),
    energy: round(average(checkIns.map((entry) => entry.energy))),
    ...(stress.length > 0 && { stress: round(average(stress)) }),
    bestDay: best.day,
    hardestDay: hardest.day,
    trend,
    byDay,
  };
}

/** Collects everything a review of `period` around `anchorDay` is made of. `now` decides what is overdue. */
export async function buildReviewDigest(period: ReviewPeriod, anchorDay: DayKey, now: Date = new Date()): Promise<ReviewDigest> {
  const { startDay, endDay } = periodRange(period, anchorDay);
  const { from, to } = dayRangeToISO(startDay, endDay);
  const today = localDayKey(now);
  // "Overdue" is judged at the end of a finished period, at this moment for a running one.
  const asOf = new Date(Math.min(now.getTime(), startOfDayInstant(addDays(endDay, 1)).getTime() - 1)).toISOString();
  const inPeriod = (at: string | undefined): at is string => at !== undefined && at >= from && at < to;

  const [captures, allCheckIns, allItems, allPatterns, people] = await Promise.all([
    capturesRepo.list({ fromDay: startDay, toDay: endDay }),
    checkinsRepo.listRange(startDay, endDay),
    itemsRepo.list(),
    patternsRepo.list(),
    peopleRepo.list({ includeArchived: true }),
  ]);
  // A mood the user has not confirmed is still a guess: it stays out of the digest, like on the «Сегодня» screen.
  const checkIns = allCheckIns.filter((checkIn) => !isHiddenFromAi(checkIn) && checkIn.origin !== 'ai_suggested');
  const personName = new Map(people.map((person) => [person.id, person.name]));
  const entryOf = (item: Item, extra: Partial<DigestEntry> = {}): DigestEntry => {
    const counterpart = item.kind === 'commitment' ? (item.counterpartyName ?? (item.counterpartyId ? personName.get(item.counterpartyId) : undefined)) : undefined;
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      ...(counterpart && { person: counterpart }),
      ...(item.kind === 'commitment' && { direction: item.direction }),
      ...extra,
    };
  };

  // ───── Stats
  const created = allItems.filter((item) => inPeriod(item.createdAt) && item.status !== 'proposed' && item.status !== 'dismissed');
  const itemsCreated: Partial<Record<ItemKind, number>> = {};
  for (const item of created) itemsCreated[item.kind] = (itemsCreated[item.kind] ?? 0) + 1;

  const open = allItems.filter((item) => item.status === 'active');
  const openCommitments = open.filter((item): item is Extract<Item, { kind: 'commitment' }> => item.kind === 'commitment');

  // ───── Wins
  const wins: { at: string; entry: DigestEntry }[] = [];
  for (const item of allItems) {
    // Predictions and decisions are done once closed, whatever the outcome; their own branches below judge it.
    if (item.status === 'done' && item.kind !== 'prediction' && item.kind !== 'decision' && inPeriod(item.doneAt)) wins.push({ at: item.doneAt, entry: entryOf(item, { day: localDayKey(item.doneAt) }) });
    if (item.kind === 'prediction' && inPeriod(item.resolvedAt) && (item.outcome === 'true' || item.outcome === 'false')) {
      const leaned = item.probability >= LEAN_THRESHOLD ? 'true' : item.probability <= 1 - LEAN_THRESHOLD ? 'false' : undefined;
      if (leaned === item.outcome) wins.push({ at: item.resolvedAt, entry: entryOf(item, { day: localDayKey(item.resolvedAt) }) });
    }
    if (item.kind === 'decision' && item.outcome && inPeriod(item.outcome.at) && item.outcome.rating >= GOOD_OUTCOME_RATING) {
      wins.push({ at: item.outcome.at, entry: entryOf(item, { day: localDayKey(item.outcome.at) }) });
    }
  }
  wins.sort((a, b) => b.at.localeCompare(a.at));
  const winEntries = wins.map(({ entry }) => entry);

  // ───── Overdue (open now, due before the end of the period or now, whichever is earlier)
  const overdueAll = open
    .filter((item) => item.dueAt !== undefined && localDayKey(item.dueAt) < localDayKey(asOf) && isAwaitingAction(item))
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
  const overdue = overdueAll.slice(0, MAX_OVERDUE).map((item) => {
    const day = localDayKey(item.dueAt ?? asOf);
    return entryOf(item, { day, daysOverdue: Math.max(1, diffDays(day, localDayKey(asOf))) });
  });

  // ───── Decisions made in the period
  const decisions = created
    .filter((item) => item.kind === 'decision')
    .slice(0, MAX_DECISIONS)
    .map((item) => entryOf(item, { day: localDayKey(item.createdAt) }));

  // ───── Patterns seen in the period
  const patterns = allPatterns
    .filter((pattern) => pattern.status !== 'rejected' && pattern.lastSeenDay >= startDay && pattern.lastSeenDay <= endDay)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, MAX_PATTERNS)
    .map(({ id, title, kind, status, confidence, occurrences }) => ({ id, title, kind, status, confidence: round(confidence), occurrences }));

  // ───── People
  const mentions = new Map<ID, number>();
  for (const capture of captures) for (const id of capture.personIds) mentions.set(id, (mentions.get(id) ?? 0) + 1);
  const peopleDigest: DigestPerson[] = [...mentions.entries()]
    .sort((a, b) => b[1] - a[1] || (personName.get(a[0]) ?? '').localeCompare(personName.get(b[0]) ?? '', 'ru'))
    .slice(0, MAX_PEOPLE)
    .flatMap(([id, count]) => {
      const person = people.find((candidate) => candidate.id === id);
      if (!person) return [];
      return [
        {
          id,
          name: person.name,
          role: person.role,
          mentions: count,
          ...(person.relationMood !== undefined && { relationMood: round(person.relationMood) }),
          openIOwe: openCommitments.filter((item) => item.direction === 'i_owe' && item.counterpartyId === id).length,
          openOwedToMe: openCommitments.filter((item) => item.direction === 'owed_to_me' && item.counterpartyId === id).length,
        },
      ];
    });

  // ───── Themes
  const tagCounts = new Map<string, number>();
  for (const capture of captures) for (const tag of capture.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  const themes = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
    .slice(0, MAX_THEMES)
    .map(([tag, count]) => ({ tag, count }));

  // ───── Calibration
  const predictions = allItems.filter((item): item is Extract<Item, { kind: 'prediction' }> => item.kind === 'prediction');
  const closedHere = toForecasts(predictions.filter((item) => inPeriod(item.resolvedAt)));
  const brierInPeriod = brierScore(closedHere);

  const daysElapsed = Math.max(0, diffDays(startDay, endDay < today ? endDay : today) + 1);
  return {
    period,
    startDay,
    endDay,
    stats: {
      captures: captures.length,
      activeDays: new Set(captures.map((capture) => capture.day)).size,
      days: daysElapsed,
      words: captures.reduce((sum, capture) => sum + countWords(capture.text), 0),
      voiceMinutes: Math.round(captures.reduce((sum, capture) => sum + (capture.durationSec ?? 0), 0) / 60),
      checkins: checkIns.length,
      itemsCreated,
      itemsCreatedTotal: created.length,
      done: winEntries.filter((win) => win.kind !== 'prediction' && win.kind !== 'decision').length,
      overdue: overdueAll.length,
      openIOwe: openCommitments.filter((item) => item.direction === 'i_owe').length,
      openOwedToMe: openCommitments.filter((item) => item.direction === 'owed_to_me').length,
    },
    wins: winEntries.slice(0, MAX_WINS),
    overdue,
    decisions,
    patterns,
    people: peopleDigest,
    themes,
    calibration: {
      overall: calibrationReport(predictions),
      closedInPeriod: closedHere.length,
      ...(brierInPeriod !== null && { brierInPeriod: round(brierInPeriod, 3) }),
    },
    mood: moodDigest(checkIns),
  };
}

/** Nothing happened in the period: no point in asking a model about it. */
export function isEmptyDigest(digest: ReviewDigest): boolean {
  const { stats } = digest;
  return stats.captures === 0 && stats.checkins === 0 && stats.itemsCreatedTotal === 0 && stats.done === 0 && stats.overdue === 0;
}

// ───────── Rules: sections without a model ─────────

const KIND_ORDER: readonly ItemKind[] = ['decision', 'commitment', 'prediction', 'idea', 'task', 'question', 'lesson', 'fact'];

const bullets = (lines: readonly string[]): string => lines.map((line) => `• ${line}`).join('\n');
const percent = (unit: number): string => `${Math.round(unit * 100)}%`;
const signed = (value: number): string => (value > 0 ? `+${value.toFixed(1)}` : value.toFixed(1));

function valenceWord(valence: number): string {
  if (valence >= 0.5) return t('very pleasant', undefined, 'reviews');
  if (valence >= 0.15) return t('rather pleasant', undefined, 'reviews');
  if (valence > -0.15) return t('even', undefined, 'reviews');
  if (valence > -0.5) return t('rather hard', undefined, 'reviews');
  return t('heavy');
}

function moodWord(mood: number): string {
  return mood > 0.3 ? t('warm', undefined, 'reviews') : mood < -0.3 ? t('tense', undefined, 'reviews') : t('steady');
}

/** Only kinds that can be overdue have a label. */
const KIND_ACTION: Partial<Record<ItemKind, string>> = {
  get decision() { return t('Reconsider the decision') },
  get commitment() { return t('Promise') },
  get prediction() { return t('Close the prediction') },
  get task() { return t('Task') },
};

function statsSection(digest: ReviewDigest): ReviewSection {
  const { stats } = digest;
  const lines: string[] = [];
  if (stats.captures === 0) lines.push(t('No records in the period.'));
  else {
    const voice = stats.voiceMinutes > 0 ? t(', {voiceMinutes} min by voice.', { voiceMinutes: stats.voiceMinutes }) : '.';
    lines.push(t('{recordsCount}, {wordsCount}{voice} Active days: {activeDays} of {days}.', { recordsCount: recordsCount(stats.captures), wordsCount: wordsCount(stats.words), voice, activeDays: stats.activeDays, days: stats.days }));
  }
  const created = KIND_ORDER.filter((kind) => (stats.itemsCreated[kind] ?? 0) > 0).map((kind) => itemKindCount(kind, stats.itemsCreated[kind] ?? 0));
  if (created.length > 0) lines.push(t('New: {v}.', { v: created.join(', ') }));
  if (stats.openIOwe + stats.openOwedToMe > 0) {
    lines.push(t('Open promises: I owe — {openIOwe}, owed to me — {openOwedToMe}.', { openIOwe: stats.openIOwe, openOwedToMe: stats.openOwedToMe }));
  }
  if (digest.themes.length > 0) lines.push(t('Topics: {v}.', { v: digest.themes.map((theme) => `${theme.tag} (${theme.count})`).join(', ') }));
  return { id: 'stats', title: t('Numbers of the period'), kind: 'stats', body: lines.join('\n'), data: stats };
}

function winsSection(digest: ReviewDigest): ReviewSection {
  const lines = digest.wins.map((win) => {
    if (win.kind === 'prediction') return t('The prediction came true as you thought: {title}', { title: win.title });
    if (win.kind === 'decision') return t('The decision worked: {title}', { title: win.title });
    return t('Closed: {title}', { title: win.title });
  });
  return { id: 'wins', title: t('What went well'), kind: 'wins', body: bullets(lines), data: digest.wins };
}

function overdueSection(digest: ReviewDigest): ReviewSection {
  const lines = digest.overdue.map((entry) => {
    const who = entry.person ? `${entry.direction === 'owed_to_me' ? t('owed to me') : t('I owe', undefined, 'reviews')}: ${entry.person}` : '';
    const details = [t('overdue by {daysCount}', { daysCount: daysCount(entry.daysOverdue ?? 1) }), who].filter(Boolean).join('; ');
    return `${KIND_ACTION[entry.kind] ?? t('Task', undefined, 'reviews')}: ${entry.title} (${details})`;
  });
  const rest = digest.stats.overdue - digest.overdue.length;
  return {
    id: 'overdue',
    title: t('What is overdue'),
    kind: 'overdue',
    body: [bullets(lines), rest > 0 ? t('And {rest} more.', { rest }) : ''].filter(Boolean).join('\n'),
    data: digest.overdue,
  };
}

function patternsSection(digest: ReviewDigest): ReviewSection {
  const lines = digest.patterns.map(
    (pattern) => t('{title} — {timesCount}, confidence {percent}{v}', { title: pattern.title, timesCount: timesCount(pattern.occurrences), percent: percent(pattern.confidence), v: pattern.status === 'confirmed' ? t(', confirmed by you') : '' }),
  );
  return { id: 'patterns', title: t('What repeats'), kind: 'patterns', body: bullets(lines), data: digest.patterns };
}

function peopleSection(digest: ReviewDigest): ReviewSection {
  const lines = digest.people.map((person) => {
    const open = [person.openIOwe > 0 ? t('I owe: {openIOwe}', { openIOwe: person.openIOwe }) : '', person.openOwedToMe > 0 ? t('owed to me: {openOwedToMe}', { openOwedToMe: person.openOwedToMe }) : ''].filter(Boolean);
    return [`${person.name} — ${mentionsCount(person.mentions)}`, ...open, person.relationMood === undefined ? '' : t('relationship {moodWord}', { moodWord: moodWord(person.relationMood) })]
      .filter(Boolean)
      .join('; ');
  });
  return { id: 'people', title: t('People of the period'), kind: 'people', body: bullets(lines), data: digest.people };
}

function calibrationSection(digest: ReviewDigest): ReviewSection {
  const { overall, closedInPeriod, brierInPeriod } = digest.calibration;
  const lines: string[] = [];
  if (closedInPeriod > 0) {
    lines.push(t('Closed in the period: {predictionsCount}{v}.', { predictionsCount: predictionsCount(closedInPeriod), v: brierInPeriod === undefined ? '' : t(', Brier error {toFixed}', { toFixed: brierInPeriod.toFixed(2) }) }));
  }
  if (overall.enough) {
    const lean = overall.bias > 0.1 ? t('You tend to overrate the chances of “yes”.') : overall.bias < -0.1 ? t('You tend to underrate the chances of “yes”.') : t('Confidence and results broadly agree.');
    lines.push(
      t('Closed in total: {closed}; on average you gave {percent}, and {percent2} came true. Brier {toFixed} (0 is perfect, 0.25 is “always 50%”). {lean}', { closed: overall.closed, percent: percent(overall.meanProbability), percent2: percent(overall.hitRate), toFixed: overall.brier.toFixed(2), lean }),
    );
  } else {
    lines.push(t('Calibration needs {needed} closed predictions, you have {closed}.', { needed: overall.needed, closed: overall.closed }));
  }
  return { id: 'calibration', title: t('Prediction accuracy'), kind: 'calibration', body: lines.join('\n'), data: digest.calibration };
}

const TREND_TEXT: Record<DigestMood['trend'], string> = {
  get up() { return t('Mood was rising toward the end of the period.') },
  get down() { return t('Mood was falling toward the end of the period.') },
  get flat() { return t('Mood stayed about the same.') },
  unknown: '',
};

function moodSection(mood: DigestMood): ReviewSection {
  const lines = [
    t('{checkinsCount}: mood {valenceWord} ({signed}), energy {percent}{v}.', { checkinsCount: checkinsCount(mood.checkins), valenceWord: valenceWord(mood.valence), signed: signed(mood.valence), percent: percent(mood.energy), v: mood.stress === undefined ? '' : t(', tension {percent}', { percent: percent(mood.stress) }) }),
  ];
  if (mood.bestDay !== mood.hardestDay) {
    lines.push(t('Easiest: {formatDayWithWeekday}. Hardest: {formatDayWithWeekday2}.', { formatDayWithWeekday: formatDayWithWeekday(mood.bestDay), formatDayWithWeekday2: formatDayWithWeekday(mood.hardestDay) }));
  }
  if (TREND_TEXT[mood.trend] !== '') lines.push(TREND_TEXT[mood.trend]);
  return { id: 'mood', title: t('State'), kind: 'mood', body: lines.join('\n'), data: mood.byDay };
}

export interface RulesReview {
  headline: string;
  sections: ReviewSection[];
  questions: string[];
}

function rulesHeadline(digest: ReviewDigest): string {
  const { stats } = digest;
  if (isEmptyDigest(digest)) return t('No records in this period');
  const parts = [recordsCount(stats.captures)];
  if (stats.done > 0) parts.push(t('closed {done}', { done: stats.done }));
  if (stats.overdue > 0) parts.push(t('overdue {overdue}', { overdue: stats.overdue }));
  return parts.join(', ');
}

function rulesQuestions(digest: ReviewDigest): string[] {
  const questions: string[] = [];
  const late = digest.overdue[0];
  if (late) questions.push(t('What really keeps you from closing “{truncate}”: time, desire, or is it no longer needed?', { truncate: truncate(late.title, 80) }));
  const { overall } = digest.calibration;
  if (overall.enough && Math.abs(overall.bias) > 0.1) {
    questions.push(overall.bias > 0 ? t('Where are you most often too sure of success, and what are you missing?') : t('Where do you underrate your chances, and what keeps you from taking the risk?'));
  }
  if (digest.mood?.trend === 'down') questions.push(t('What took the most energy in this period, and what of it can be removed?'));
  const pattern = digest.patterns[0];
  if (pattern) questions.push(t('“{truncate}” came up again. What do you want to do about it?', { truncate: truncate(pattern.title, 80) }));
  const win = digest.wins[0];
  if (win) questions.push(t('What helped you close “{truncate}”, and how can you repeat that elsewhere?', { truncate: truncate(win.title, 80) }));
  if (questions.length < 2) questions.push(t('What from this period do you want to repeat, and what not anymore?'));
  if (questions.length < 2) questions.push(t('Which one step would change the most in the next period?'));
  return questions.slice(0, 3);
}

/** The review a person gets without any model: numbers, lists and questions straight from the digest. */
export function rulesReview(digest: ReviewDigest): RulesReview {
  const sections: ReviewSection[] = [statsSection(digest)];
  if (digest.wins.length > 0) sections.push(winsSection(digest));
  if (digest.overdue.length > 0) sections.push(overdueSection(digest));
  if (digest.patterns.length > 0) sections.push(patternsSection(digest));
  if (digest.people.length > 0) sections.push(peopleSection(digest));
  if (digest.calibration.closedInPeriod > 0 || digest.calibration.overall.closed > 0) sections.push(calibrationSection(digest));
  if (digest.mood) sections.push(moodSection(digest.mood));
  return { headline: rulesHeadline(digest), sections, questions: rulesQuestions(digest) };
}

// ───────── Generation ─────────

export interface ReviewDeps {
  /** Without it (or with `useAi: false`) the review is made by rules only. */
  llm?: LlmProvider;
  useAi?: boolean;
  now?: Date;
  signal?: AbortSignal;
  /** Store the review (replacing the one of the same period, keeping the user's answers). Default true. */
  save?: boolean;
}

export interface ReviewResult {
  review: Review;
  digest: ReviewDigest;
  /** Why the model's part is missing although a provider was given. */
  aiError?: string;
  usage?: Usage;
}

const AI_MAX_SECTIONS = 4;
const AI_MAX_QUESTIONS = 3;

/**
 * Builds (and by default stores) the review of the period around `anchorDay`. The model never replaces the
 * rules sections: its headline and written sections come first, the computed ones follow.
 */
export async function generateReview(period: ReviewPeriod, anchorDay: DayKey, deps: ReviewDeps = {}): Promise<ReviewResult> {
  const digest = await buildReviewDigest(period, anchorDay, deps.now);
  const rules = rulesReview(digest);
  let { headline, questions } = rules;
  let sections = rules.sections;
  let generatedBy: Review['generatedBy'] = 'rules';
  let aiError: string | undefined;
  let usage: Usage | undefined;

  if (deps.llm && deps.useAi !== false && !isEmptyDigest(digest)) {
    try {
      const answer = await deps.llm.structured({
        system: buildReviewSystem(),
        user: buildReviewUser({ period, startDay: digest.startDay, endDay: digest.endDay, profile: await profileRepo.get(), digest }),
        schemaName: SCHEMA_NAMES.review,
        jsonSchema: reviewJsonSchema,
        zod: ReviewSchema,
        purpose: 'review',
        tier: 'smart',
        signal: deps.signal,
      });
      usage = answer.usage;
      const written: ReviewSection[] = answer.data.sections
        .map((section) => ({ title: section.title.trim(), body: section.body.trim() }))
        .filter((section) => section.title !== '' && section.body !== '')
        .slice(0, AI_MAX_SECTIONS)
        .map((section, index) => ({ id: `ai-${index + 1}`, title: truncate(section.title, 60), kind: 'text' as const, body: truncate(section.body, 1_200) }));
      const asked = answer.data.questions.map((question) => truncate(question.trim(), 240)).filter((question) => question !== '').slice(0, AI_MAX_QUESTIONS);
      const writtenHeadline = answer.data.headline.replace(/\s+/g, ' ').trim();
      if (written.length > 0 || writtenHeadline !== '') {
        generatedBy = 'ai';
        headline = writtenHeadline === '' ? headline : truncate(writtenHeadline, 140);
        sections = [...written, ...sections];
        if (asked.length > 0) questions = asked;
      }
    } catch (error) {
      if (isAbortedError(error)) throw error;
      aiError = describeError(error);
    }
  }

  const input = { period, startDay: digest.startDay, endDay: digest.endDay, headline, sections, questions, generatedBy };
  const review: Review = deps.save === false ? previewReview(input) : await reviewsRepo.upsert(input);
  return { review, digest, ...(aiError && { aiError }), ...(usage && { usage }) };
}

/** A review that is not stored: shown, not kept. */
function previewReview(input: Pick<Review, 'period' | 'startDay' | 'endDay' | 'headline' | 'sections' | 'questions' | 'generatedBy'>): Review {
  const at = new Date().toISOString();
  return { ...input, id: `preview-${input.period}-${input.startDay}`, createdAt: at, updatedAt: at };
}
