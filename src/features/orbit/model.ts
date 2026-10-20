import { addDays, diffDays, isDayKey, eachDay, localDayKey, localMinutesOfDay, periodRange } from '../../domain/dates';
import { daysCount } from '../../domain/counts';
import { t } from '../../i18n';
import type { Capture, CheckIn, DayKey, Item, ItemKind, ItemOfKind, Pattern, ReviewPeriod } from '../../domain/types';
import type { DayCell, DiskMood, DiskSegment, TypeKind } from '../../ui';

/** The «Время» views. */
export const TIME_VIEWS = ['day', 'week', 'month', 'year'] as const;
export type TimeView = ReviewPeriod;

export const VIEW_LABELS: Record<TimeView, string> = { get day() { return t('Day') }, get week() { return t('Week') }, get month() { return t('Month') }, get year() { return t('Year') } };

/** Layers of the figure (SPEC §4.7). */
export const LAYERS = ['state', 'records', 'commitments', 'patterns'] as const;
export type Layer = (typeof LAYERS)[number];
export const LAYER_LABELS: Record<Layer, string> = {
  get state() { return t('State') },
  get records() { return t('Records') },
  get commitments() { return t('Commitments') },
  get patterns() { return t('Patterns') },
};
export const LAYER_TYPE: Record<Layer, TypeKind> = { state: 'state', records: 'fact', commitments: 'commitment', patterns: 'pattern' };
export type Layers = Readonly<Record<Layer, boolean>>;
export const ALL_LAYERS: Layers = { state: true, records: true, commitments: true, patterns: true };

/** Days with records needed before the picture is drawn (docs §2.10: «Картина недели появится через 2 дня записей»). */
export const MIN_RECORD_DAYS = 3;
/** Days with a state needed before a trend is named. */
export const MIN_TREND_DAYS = 4;

// ───────── Tabs and URL ─────────

export const TABS = ['time', 'people', 'patterns'] as const;
export type OrbitTab = (typeof TABS)[number];
export const TAB_LABELS: Record<OrbitTab, string> = { get time() { return t('Time') }, get people() { return t('People') }, get patterns() { return t('Patterns') } };

export function parseTab(value: string | null): OrbitTab {
  return (TABS as readonly string[]).includes(value ?? '') ? (value as OrbitTab) : 'time';
}

export function parseView(value: string | null): TimeView {
  return (TIME_VIEWS as readonly string[]).includes(value ?? '') ? (value as TimeView) : 'week';
}

/** A day from the URL, or `fallback` when it is missing or not a real calendar day. */
export function parseDay(value: string | null, fallback: DayKey): DayKey {
  return value !== null && isDayKey(value) ? value : fallback;
}

// ───────── Mood ─────────

/** Check-ins the user stands behind: a suggestion from a record counts only once it is confirmed. */
export const countsForMood = (checkIn: CheckIn): boolean => checkIn.origin !== 'ai_suggested';

/** Mean state of some check-ins on the −3…+3 scale; null without any. */
export function moodOfCheckIns(checkIns: readonly CheckIn[]): number | null {
  const counted = checkIns.filter(countsForMood);
  if (counted.length === 0) return null;
  return (counted.reduce((sum, c) => sum + c.valence, 0) / counted.length) * 3;
}

function groupByDay<T extends { day: DayKey }>(rows: readonly T[]): Map<DayKey, T[]> {
  const map = new Map<DayKey, T[]>();
  for (const row of rows) {
    const list = map.get(row.day);
    if (list) list.push(row);
    else map.set(row.day, [row]);
  }
  return map;
}

// ───────── Cells and aggregates ─────────

/** One cell per day that has anything to show on the enabled layers. */
export function buildDayCells(captures: readonly Capture[], checkIns: readonly CheckIn[], layers: Layers = ALL_LAYERS): DayCell[] {
  const cells = new Map<DayKey, DayCell>();
  const cell = (date: DayKey): DayCell => {
    let current = cells.get(date);
    if (!current) {
      current = { date };
      cells.set(date, current);
    }
    return current;
  };
  if (layers.records) for (const [day, list] of groupByDay(captures)) cell(day).count = list.length;
  if (layers.state) {
    for (const [day, list] of groupByDay(checkIns)) {
      const mood = moodOfCheckIns(list);
      if (mood !== null) cell(day).mood = mood;
    }
  }
  return [...cells.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface PeriodSummary {
  /** Records in the period. */
  records: number;
  /** Days with at least one record. */
  activeDays: number;
  /** Days of the period that have already begun. */
  elapsedDays: number;
  /** Days with a confirmed state. */
  stateDays: number;
  /** Mean state of the period, −3…+3. */
  mood: number | null;
}

/** Numbers for a period: the day, the Monday week, the month or the year (days after `today` do not count). */
export function summarizePeriod(
  view: TimeView,
  day: DayKey,
  captures: readonly Capture[],
  checkIns: readonly CheckIn[],
  today: DayKey = localDayKey(),
): PeriodSummary {
  const range = periodRange(view, day);
  const inRange = (d: DayKey): boolean => d >= range.startDay && d <= range.endDay;
  const mine = captures.filter((c) => inRange(c.day));
  const states = checkIns.filter((c) => inRange(c.day));
  const lastDay = range.endDay < today ? range.endDay : today;
  return {
    records: mine.length,
    activeDays: new Set(mine.map((c) => c.day)).size,
    elapsedDays: Math.max(0, diffDays(range.startDay, lastDay) + 1),
    stateDays: new Set(states.filter(countsForMood).map((c) => c.day)).size,
    mood: moodOfCheckIns(states),
  };
}

/** Distinct days that have a record, over everything: decides between the picture and the counter. */
export function recordDaysCount(captures: readonly Pick<Capture, 'day'>[]): number {
  return new Set(captures.map((c) => c.day)).size;
}

/** “The picture of the week will appear after 2 days of records.” */
export function emptyTimeTitle(view: TimeView, haveDays: number): string {
  const left = Math.max(1, MIN_RECORD_DAYS - haveDays);
  const days = daysCount(left);
  switch (view) {
    case 'day':
      return t('The picture of the day will appear after {days} of records.', { days });
    case 'week':
      return t('The picture of the week will appear after {days} of records.', { days });
    case 'month':
      return t('The picture of the month will appear after {days} of records.', { days });
    default:
      return t('The picture of the year will appear after {days} of records.', { days });
  }
}

// ───────── Trend ─────────

export type TrendResult =
  | { kind: 'few'; haveDays: number; needDays: number }
  | { kind: 'steady'; sentences: string[] }
  | { kind: 'trend'; sentences: string[] };

const OF_PERIOD: Record<TimeView, string> = { get day() { return t('the week') }, get week() { return t('the week') }, get month() { return t('the month') }, get year() { return t('the year') } };

const mean = (values: readonly number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

interface DayState {
  day: DayKey;
  valence: number;
  energy: number;
  stress?: number;
  sleep?: number;
}

/** One value per day: the mean of that day's confirmed check-ins. */
function dayStates(checkIns: readonly CheckIn[]): DayState[] {
  const result: DayState[] = [];
  for (const [day, list] of groupByDay(checkIns.filter(countsForMood))) {
    const optional = (pick: (c: CheckIn) => number | undefined): number | undefined => {
      const values = list.map(pick).filter((v): v is number => v !== undefined);
      return values.length === 0 ? undefined : mean(values);
    };
    const stress = optional((c) => c.stress);
    const sleep = optional((c) => c.sleepHours);
    result.push({
      day,
      valence: mean(list.map((c) => c.valence)),
      energy: mean(list.map((c) => c.energy)),
      ...(stress !== undefined && { stress }),
      ...(sleep !== undefined && { sleep }),
    });
  }
  return result.sort((a, b) => a.day.localeCompare(b.day));
}

interface Finding {
  weight: number;
  text: string;
}

export const SLEEP_LIMIT_HOURS = 6.5;

/**
 * «Тренд замечен» without a model: the later half of the days with a state against the earlier half
 * (energy, mood, stress), and sleep against energy. At most two plain sentences, no blame.
 */
export function detectTrend(checkIns: readonly CheckIn[], view: TimeView): TrendResult {
  const days = dayStates(checkIns);
  if (days.length < MIN_TREND_DAYS) return { kind: 'few', haveDays: days.length, needDays: MIN_TREND_DAYS };

  const half = Math.floor(days.length / 2);
  const early = days.slice(0, half);
  const late = days.slice(days.length - half);
  const delta = (pick: (d: DayState) => number | undefined): number | null => {
    const a = early.map(pick).filter((v): v is number => v !== undefined);
    const b = late.map(pick).filter((v): v is number => v !== undefined);
    return a.length === 0 || b.length === 0 ? null : mean(b) - mean(a);
  };
  const period = OF_PERIOD[view];
  const findings: Finding[] = [];

  const energy = delta((d) => d.energy);
  if (energy !== null && Math.abs(energy) >= 0.1) {
    findings.push({
      weight: Math.abs(energy) / 0.1,
      text:
        energy < 0
          ? t('By the end of {period} you had less energy than at the start. That is normal: look at what changed in your load.', { period })
          : t('By the end of {period} you had more energy than at the start. Remember what helped.', { period }),
    });
  }
  const valence = delta((d) => d.valence);
  if (valence !== null && Math.abs(valence) >= 0.15) {
    findings.push({
      weight: Math.abs(valence) / 0.15,
      text:
        valence < 0
          ? t('Your mood toward the end of {period} is lower than at the start. This happens and is not a grade of you.', { period })
          : t('Your mood toward the end of {period} is better than at the start.', { period }),
    });
  }
  const stress = delta((d) => d.stress);
  if (stress !== null && Math.abs(stress) >= 0.1) {
    findings.push({
      weight: Math.abs(stress) / 0.1,
      text: stress > 0 ? t('Tension toward the end of {period} is higher than at the start. You can note what causes it.', { period }) : t('Tension toward the end of {period} is lower.', { period }),
    });
  }
  const withSleep = days.filter((d) => d.sleep !== undefined);
  if (withSleep.length >= MIN_TREND_DAYS) {
    const short = withSleep.filter((d) => (d.sleep ?? 0) < SLEEP_LIMIT_HOURS);
    const long = withSleep.filter((d) => (d.sleep ?? 0) >= SLEEP_LIMIT_HOURS);
    if (short.length >= 2 && long.length >= 2) {
      const gap = mean(long.map((d) => d.energy)) - mean(short.map((d) => d.energy));
      if (gap >= 0.1) {
        findings.push({
          weight: gap / 0.1 + 0.5,
          text: t('On days with less than 6.5 hours of sleep, energy is on average {round} % lower. This is just an observation.', { round: Math.round(gap * 100) }),
        });
      }
    }
  }

  findings.sort((a, b) => b.weight - a.weight);
  if (findings.length === 0) {
    return { kind: 'steady', sentences: [t('No sharp changes are visible for {period}: your state is steady.', { period })] };
  }
  return { kind: 'trend', sentences: findings.slice(0, 2).map((f) => f.text) };
}

// ───────── Tags ─────────

export interface TagCount {
  tag: string;
  count: number;
}

const capitalize = (text: string): string => (text === '' ? text : text[0]!.toUpperCase() + text.slice(1));

/** Tags of records and check-ins, with the number of times each was used («Консультантство 14, Деньги 9»). */
export function topTags(captures: readonly Capture[], checkIns: readonly CheckIn[], limit = 6): TagCount[] {
  const counts = new Map<string, number>();
  const bump = (raw: string): void => {
    const tag = raw.trim().toLowerCase();
    if (tag === '') return;
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  };
  for (const capture of captures) for (const tag of new Set(capture.tags)) bump(tag);
  for (const checkIn of checkIns) for (const tag of new Set(checkIn.tags)) bump(tag);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag: capitalize(tag), count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'ru'))
    .slice(0, limit);
}

// ───────── The day ─────────

const KIND_ORDER: readonly ItemKind[] = ['decision', 'commitment', 'prediction', 'idea', 'task', 'question', 'lesson', 'fact'];

/** The most telling kind among a record's objects: the colour of its dot. */
export function dominantKind(items: readonly Pick<Item, 'kind'>[]): ItemKind | null {
  for (const kind of KIND_ORDER) if (items.some((item) => item.kind === kind)) return kind;
  return null;
}

export interface DayDetails {
  day: DayKey;
  captures: Capture[];
  checkIns: CheckIn[];
  /** What was extracted from the day's records, by record. */
  items: Map<string, Item[]>;
  /** Commitments whose deadline falls on the day. */
  due: ItemOfKind<'commitment'>[];
  /** Patterns with evidence from the day. */
  patterns: Pattern[];
}

export function buildDayDetails(
  day: DayKey,
  captures: readonly Capture[],
  checkIns: readonly CheckIn[],
  items: readonly Item[],
  commitments: readonly ItemOfKind<'commitment'>[],
  patterns: readonly Pattern[],
): DayDetails {
  const mine = captures.filter((c) => c.day === day).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ids = new Set(mine.map((c) => c.id));
  const byCapture = new Map<string, Item[]>();
  for (const item of items) {
    if (!item.captureId || !ids.has(item.captureId) || item.status === 'dismissed') continue;
    const list = byCapture.get(item.captureId);
    if (list) list.push(item);
    else byCapture.set(item.captureId, [item]);
  }
  return {
    day,
    captures: mine,
    checkIns: checkIns.filter((c) => c.day === day).sort((a, b) => a.at.localeCompare(b.at)),
    items: byCapture,
    due: commitments.filter((c) => c.dueAt !== undefined && localDayKey(c.dueAt) === day).sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '')),
    patterns: patterns.filter((p) => p.status !== 'rejected' && p.evidence.some((e) => e.day === day)),
  };
}

/** Title of a record for lists and tooltips. */
export function captureTitle(capture: Capture): string {
  const title = capture.title?.trim();
  if (title) return title;
  const text = (capture.summary ?? capture.text).trim().replace(/\s+/g, ' ');
  if (text === '') return t('Record without text');
  return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text;
}

const MIN_SPAN_MINUTES = 6;

/** Records and deadlines on the outer ring of the day disk, on the enabled layers. */
export function diskSegments(details: DayDetails, layers: Layers): DiskSegment[] {
  const segments: DiskSegment[] = [];
  const evidence = new Set(details.patterns.flatMap((p) => p.evidence.map((e) => e.captureId)));
  if (layers.records || layers.patterns) {
    for (const capture of details.captures) {
      const isEvidence = layers.patterns && evidence.has(capture.id);
      if (!layers.records && !isEvidence) continue;
      const start = localMinutesOfDay(capture.createdAt);
      const span = Math.max(MIN_SPAN_MINUTES, Math.round((capture.durationSec ?? 0) / 60));
      const kind: TypeKind = isEvidence ? 'pattern' : (dominantKind(details.items.get(capture.id) ?? []) ?? (capture.kind === 'checkin' ? 'state' : 'fact'));
      segments.push({ id: capture.id, startMinutes: start, endMinutes: Math.min(1440, start + span), kind, label: captureTitle(capture) });
    }
  }
  if (layers.commitments) {
    for (const item of details.due) {
      const at = localMinutesOfDay(item.dueAt!);
      segments.push({ id: `item:${item.id}`, startMinutes: at, endMinutes: Math.min(1440, at + MIN_SPAN_MINUTES), kind: 'commitment', label: t('Due: {title}', { title: item.title }) });
    }
  }
  return segments;
}

/** The inner ring: each state holds until the next one, at most three hours. */
export function diskMoods(checkIns: readonly CheckIn[]): DiskMood[] {
  const counted = checkIns.filter(countsForMood).sort((a, b) => a.at.localeCompare(b.at));
  return counted.map((checkIn, index) => {
    const start = localMinutesOfDay(checkIn.at);
    const next = counted[index + 1];
    const nextStart = next ? localMinutesOfDay(next.at) : 1440;
    const end = Math.min(1440, Math.max(start + MIN_SPAN_MINUTES, Math.min(nextStart, start + 180)));
    return { startMinutes: start, endMinutes: end, mood: checkIn.valence * 3 };
  });
}

// ───────── Ranges ─────────

/** The strip of days round a day: the week before, its own week and the week after. */
export function stripDays(day: DayKey): DayKey[] {
  const range = periodRange('week', day);
  return eachDay(addDays(range.startDay, -7), addDays(range.endDay, 7));
}

/** The period used for the trend of a view (a single day is read as its week). */
export function trendPeriod(view: TimeView): TimeView {
  return view === 'day' ? 'week' : view;
}

// ───────── Layers over a period ─────────

/** Commitments with a deadline inside the range. */
export function countDue(commitments: readonly ItemOfKind<'commitment'>[], range: { startDay: DayKey; endDay: DayKey }): number {
  return commitments.filter((c) => {
    if (c.dueAt === undefined) return false;
    const day = localDayKey(c.dueAt);
    return day >= range.startDay && day <= range.endDay;
  }).length;
}

/** Patterns with evidence inside the range. */
export function countPatternsSeen(patterns: readonly Pattern[], range: { startDay: DayKey; endDay: DayKey }): number {
  return patterns.filter((p) => p.evidence.some((e) => e.day >= range.startDay && e.day <= range.endDay)).length;
}
