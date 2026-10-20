import { diffDays, formatDayRange, formatDayShort, formatMonthName, periodRange } from '../../domain/dates';
import { daysCount, recordsCount } from '../../domain/counts';
import { truncate } from '../../domain/text';
import { t, tn } from '../../i18n';
import type { DayKey, Review, ReviewPeriod, ReviewSection, ReviewSectionKind } from '../../domain/types';

/**
 * Pure model of the reviews screens: facts read out of a stored review, the story slides built from them and the
 * hiding of names. Sections are read defensively: rules reviews carry typed `data`, demo/old reviews carry other shapes,
 * and the plain `body` text is always there as the fallback.
 */

// ───────── Wording ─────────

export const PERIOD_LABEL: Record<ReviewPeriod, string> = { get day() { return t('Day') }, get week() { return t('Week') }, get month() { return t('Month') }, get year() { return t('Year') } };

const MASK = '•••';

const groupThousands = (value: number): string => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** "Неделя 5–11 октября", "Октябрь 2026", "2026 год", "Итоги дня, 9 октября". */
export function periodTitle(period: ReviewPeriod, startDay: DayKey, endDay: DayKey): string {
  switch (period) {
    case 'day':
      return t('Summary of the day, {formatDayRange}', { formatDayRange: formatDayRange(startDay, startDay) });
    case 'week':
      return t('Week {formatDayRange}', { formatDayRange: formatDayRange(startDay, endDay) });
    case 'month':
      return `${capitalize(formatMonthName(startDay))} ${startDay.slice(0, 4)}`;
    case 'year':
      return t('Year {v}', { v: startDay.slice(0, 4) });
  }
}

function capitalize(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

// ───────── Reading a review ─────────

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const rec = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

export function findSection(review: Pick<Review, 'sections'>, kind: ReviewSectionKind): ReviewSection | undefined {
  return review.sections.find((section) => section.kind === kind);
}

/** Lines of a section body without bullet marks. */
export function sectionLines(section: ReviewSection | undefined): string[] {
  if (!section) return [];
  return section.body
    .split('\n')
    .map((line) => line.replace(/^\s*[•\-–—*]\s*/, '').replace(/\.{2,}/g, '.').trim())
    .filter((line) => line !== '');
}

export interface ReviewFacts {
  captures: number;
  activeDays: number;
  days: number;
  words: number;
  voiceMinutes: number;
  itemsTotal: number;
  decisions: number;
  commitments: number;
  ideas: number;
  done: number;
  overdue: number;
  openIOwe: number | undefined;
  openOwedToMe: number | undefined;
  /** Mood per check-in day on the −3…+3 scale. */
  moodPoints: number[];
  /** Average mood on the −1…+1 scale, when there are check-ins. */
  moodAverage: number | undefined;
  topPerson: string | undefined;
  wins: string[];
  overdueLines: string[];
  patternLines: string[];
  peopleLines: string[];
  calibrationLines: string[];
  moodLines: string[];
  /** Sections written by the model (or the demo's "main"): kind `text`. */
  written: ReviewSection[];
}

function firstName(line: string): string | undefined {
  const name = line.split(/\s+[—–]\s+|\s*\(|:/)[0]?.trim();
  return name && name.length <= 60 ? name : undefined;
}

function moodPointsOf(section: ReviewSection | undefined): number[] {
  const data = section?.data;
  const rows = Array.isArray(data) ? data : Array.isArray(rec(data)?.days) ? (rec(data)?.days as unknown[]) : [];
  return rows.flatMap((row) => {
    const valence = num(rec(row)?.valence);
    return valence === undefined ? [] : [Math.max(-3, Math.min(3, valence * 3))];
  });
}

export function readFacts(review: Review): ReviewFacts {
  const stats = rec(findSection(review, 'stats')?.data) ?? {};
  const created = rec(stats.itemsCreated) ?? {};
  const wins = sectionLines(findSection(review, 'wins'));
  const overdueLines = sectionLines(findSection(review, 'overdue'));
  const peopleSection = findSection(review, 'people');
  const peopleLines = sectionLines(peopleSection);
  const peopleData = Array.isArray(peopleSection?.data) ? peopleSection.data : [];
  const topFromData = typeof rec(peopleData[0])?.name === 'string' ? (rec(peopleData[0])?.name as string) : undefined;
  const moodSection = findSection(review, 'mood');
  const moodPoints = moodPointsOf(moodSection);
  const { startDay, endDay } = review;
  return {
    captures: num(stats.captures) ?? 0,
    activeDays: num(stats.activeDays) ?? 0,
    days: num(stats.days) ?? Math.max(1, diffDays(startDay, endDay) + 1),
    words: num(stats.words) ?? 0,
    voiceMinutes: num(stats.voiceMinutes) ?? 0,
    itemsTotal: num(stats.itemsCreatedTotal) ?? num(stats.items) ?? 0,
    decisions: num(created.decision) ?? 0,
    commitments: num(created.commitment) ?? 0,
    ideas: num(created.idea) ?? 0,
    done: num(stats.done) ?? wins.length,
    overdue: num(stats.overdue) ?? overdueLines.length,
    openIOwe: num(stats.openIOwe),
    openOwedToMe: num(stats.openOwedToMe),
    moodPoints,
    moodAverage: moodPoints.length ? moodPoints.reduce((a, b) => a + b, 0) / moodPoints.length / 3 : undefined,
    topPerson: topFromData ?? (peopleLines[0] ? firstName(peopleLines[0]) : undefined),
    wins,
    overdueLines,
    patternLines: sectionLines(findSection(review, 'patterns')),
    peopleLines,
    calibrationLines: sectionLines(findSection(review, 'calibration')),
    moodLines: sectionLines(moodSection),
    written: review.sections.filter((section) => section.kind === 'text' && section.body.trim() !== ''),
  };
}

/** A word for the average mood, −1…+1. */
export function moodVerdict(average: number | undefined): string {
  if (average === undefined) return t('not logged');
  if (average >= 0.5) return t('very pleasant');
  if (average >= 0.15) return t('rather pleasant');
  if (average > -0.15) return t('steady');
  if (average > -0.5) return t('rather hard');
  return t('hard');
}

// ───────── Slides ─────────

export interface SlideStat {
  label: string;
  value: string;
}

export interface SlideGroup {
  title?: string;
  items: string[];
}

export type SlideSpec =
  | { id: string; type: 'cover'; label: string; eyebrow: string; word: string; title: string; subtitle?: string; glow: number }
  | { id: string; type: 'poster'; label: string; month: number; year: number; phrase: string; moods: (number | null)[]; stats: SlideStat[] }
  | {
      id: string;
      type: 'passport';
      label: string;
      year: number;
      hero: { value: number; label: string };
      stats: { label: string; value: number }[];
      issuedOn: DayKey;
    }
  | {
      id: string;
      type: 'ticket';
      label: string;
      date: DayKey;
      from: number | null;
      to: number | null;
      hero: { value: number; label: string };
      stats: SlideStat[];
    }
  | {
      id: string;
      type: 'metrics';
      label: string;
      eyebrow: string;
      title: string;
      hero: SlideStat;
      metrics: SlideStat[];
      compare?: { caption: string; nowLabel: string; now: number; beforeLabel: string; before: number };
      glow: number;
    }
  | { id: string; type: 'list'; label: string; eyebrow: string; title: string; groups: SlideGroup[]; footer?: string; glow: number }
  | { id: string; type: 'text'; label: string; eyebrow: string; title: string; body: string; glow: number }
  | { id: string; type: 'mood'; label: string; eyebrow: string; title: string; points: number[]; verdict: string; lines: string[]; glow: number };

export interface MonthCompare {
  /** The day of the month both counts run up to. */
  dayOfMonth: number;
  now: number;
  before: number;
  /** "сентябрь" */
  beforeMonth: string;
  /** The month is over: the whole of it is compared, not up to a day. */
  full: boolean;
}

export interface SlideContext {
  today: DayKey;
  /** Mood per day of the month (index 0 = the 1st), −3…+3 or null: the poster's dots. */
  monthMoods?: (number | null)[];
  compare?: MonthCompare;
  /** First and last mood of the day for the ticket. */
  dayMood?: { from: number | null; to: number | null };
}

const MAX_ITEMS = 5;

function eyebrowFor(review: Review): string {
  switch (review.period) {
    case 'day':
      return t('Summary of the day');
    case 'week':
      return t('Weekly reading · {formatDayRange}', { formatDayRange: formatDayRange(review.startDay, review.endDay) });
    case 'month':
      return t('Month summary · {v}', { v: review.startDay.slice(0, 4) });
    case 'year':
      return t('Year summary · {v}', { v: review.startDay.slice(0, 4) });
  }
}

/** Glow colour of a slide: the period's average mood on −3…+3 (0 when unknown). */
const glowOf = (facts: ReviewFacts): number => (facts.moodAverage ?? 0) * 3;

function heroMetrics(facts: ReviewFacts, withDays: boolean): SlideStat[] {
  const stats: SlideStat[] = [];
  if (withDays) stats.push({ label: t('Days with records'), value: t('{activeDays} of {days}', { activeDays: facts.activeDays, days: facts.days }) });
  if (facts.words > 0) stats.push({ label: t('Words', undefined, 'model'), value: groupThousands(facts.words) });
  stats.push({ label: t('New objects'), value: String(facts.itemsTotal) });
  stats.push({ label: t('Closed', undefined, 'model'), value: String(facts.done) });
  if (facts.overdue > 0) stats.push({ label: t('Overdue'), value: String(facts.overdue) });
  return stats;
}

function winsSlide(review: Review, facts: ReviewFacts, title: string): SlideSpec | undefined {
  if (facts.wins.length === 0) return undefined;
  const items = facts.wins.slice(0, MAX_ITEMS);
  return {
    id: 'wins',
    type: 'list',
    label: t('What went well'),
    eyebrow: eyebrowFor(review),
    title,
    groups: [{ items }],
    footer: facts.wins.length > items.length ? t('And {v} more', { v: facts.wins.length - items.length }) : undefined,
    glow: 2,
  };
}

function overdueSlide(review: Review, facts: ReviewFacts, title: string): SlideSpec | undefined {
  if (facts.overdueLines.length === 0) return undefined;
  const owe =
    facts.openIOwe !== undefined && facts.openOwedToMe !== undefined
      ? t('Open: I owe {openIOwe} · owed to me {openOwedToMe}', { openIOwe: facts.openIOwe, openOwedToMe: facts.openOwedToMe })
      : undefined;
  return {
    id: 'overdue',
    type: 'list',
    label: t('Overdue and commitments'),
    eyebrow: eyebrowFor(review),
    title,
    groups: [{ items: facts.overdueLines.slice(0, 4) }],
    footer: owe,
    glow: -2,
  };
}

function patternsPeopleSlide(review: Review, facts: ReviewFacts): SlideSpec | undefined {
  const groups: SlideGroup[] = [];
  if (facts.patternLines.length) groups.push({ title: t('Repeats'), items: facts.patternLines.slice(0, 3) });
  if (facts.peopleLines.length) groups.push({ title: t('People'), items: facts.peopleLines.slice(0, 3) });
  if (groups.length === 0) return undefined;
  return { id: 'patterns', type: 'list', label: t('Patterns and people'), eyebrow: eyebrowFor(review), title: t('What and who is around'), groups, glow: 0 };
}

function moodSlide(review: Review, facts: ReviewFacts): SlideSpec | undefined {
  const lines = [...facts.moodLines, ...facts.calibrationLines].slice(0, 4);
  if (facts.moodPoints.length === 0 && lines.length === 0) return undefined;
  return {
    id: 'mood',
    type: 'mood',
    label: t('State and prediction accuracy'),
    eyebrow: eyebrowFor(review),
    title: facts.moodPoints.length ? t('How you felt') : t('Prediction accuracy'),
    points: facts.moodPoints,
    verdict: facts.moodPoints.length ? moodVerdict(facts.moodAverage) : '',
    lines,
    glow: glowOf(facts),
  };
}

function writtenSlide(review: Review, facts: ReviewFacts): SlideSpec | undefined {
  const section = facts.written[0];
  if (!section) return undefined;
  return {
    id: 'written',
    type: 'text',
    label: section.title,
    eyebrow: eyebrowFor(review),
    title: section.title,
    body: truncate(section.body.replace(/\s+/g, ' ').trim(), 420),
    glow: glowOf(facts),
  };
}

function compact<T>(items: ReadonlyArray<T | undefined>): T[] {
  return items.filter((item): item is T => item !== undefined);
}

/**
 * The slides of a review: a week is about five cards (numbers, wins, overdue and obligations, patterns and people,
 * mood and calibration), a month is the poster, a phrase, the glass card of metrics with the comparison to the same
 * day of the previous month and the highlights, a year is the cover, the passport and the same cards, a day is the ticket
 * and its lists. A card with nothing to say is left out; an empty period still gets its numbers card.
 */
export function buildSlides(review: Review, context: SlideContext): SlideSpec[] {
  const facts = readFacts(review);
  const glow = glowOf(facts);
  const eyebrow = eyebrowFor(review);
  const headline = review.headline.trim() || periodTitle(review.period, review.startDay, review.endDay);
  const recordsLine = recordsCount(facts.captures);

  const metrics = (title: string, withDays: boolean, extra?: Partial<Extract<SlideSpec, { type: 'metrics' }>>): SlideSpec => ({
    id: 'metrics',
    type: 'metrics',
    label: t('Numbers: {recordsLine}', { recordsLine }),
    eyebrow,
    title,
    hero: { value: String(facts.captures), label: tn(facts.captures, 'record', 'records') },
    metrics: heroMetrics(facts, withDays),
    glow,
    ...extra,
  });

  switch (review.period) {
    case 'day': {
      const mood = context.dayMood ?? { from: null, to: null };
      return compact<SlideSpec>([
        {
          id: 'ticket',
          type: 'ticket',
          label: t('Day summary: {recordsLine}', { recordsLine }),
          date: review.startDay,
          from: mood.from,
          to: mood.to,
          hero: { value: facts.captures, label: tn(facts.captures, 'record', 'records') },
          stats: [
            { label: t('CLOSED'), value: String(facts.done) },
            { label: t('PENDING'), value: String(facts.overdue) },
            { label: t('NEW'), value: String(facts.itemsTotal) },
          ],
        },
        writtenSlide(review, facts),
        winsSlide(review, facts, t('What went well today')),
        overdueSlide(review, facts, t('What is pending')),
      ]);
    }
    case 'week':
      return compact<SlideSpec>([
        metrics(truncate(headline, 90), true),
        writtenSlide(review, facts),
        winsSlide(review, facts, t('Wins of the week')),
        overdueSlide(review, facts, t('Overdue and commitments')),
        patternsPeopleSlide(review, facts),
        moodSlide(review, facts),
      ]);
    case 'month': {
      const { year, month } = { year: Number(review.startDay.slice(0, 4)), month: Number(review.startDay.slice(5, 7)) };
      const compare = context.compare;
      const moodWord = facts.moodPoints.length ? moodVerdict(facts.moodAverage) : undefined;
      const monthMetrics: SlideStat[] = compact<SlideStat>([
        { label: t('Decisions'), value: String(facts.decisions) },
        { label: t('Tasks closed'), value: String(facts.done) },
        { label: t('Ideas'), value: String(facts.ideas) },
        moodWord ? { label: t('State'), value: moodWord } : undefined,
        facts.topPerson ? { label: t('Top person'), value: facts.topPerson } : undefined,
      ]);
      const phraseBody =
        facts.written[0]?.body.replace(/\s+/g, ' ').trim() ??
        t('Days with records: {activeDays} of {days}. New objects: {itemsTotal}, closed: {done}.', { activeDays: facts.activeDays, days: facts.days, itemsTotal: facts.itemsTotal, done: facts.done });
      return compact<SlideSpec>([
        {
          id: 'poster',
          type: 'poster',
          label: `${capitalize(formatMonthName(review.startDay))} ${year}`,
          month,
          year,
          phrase: truncate(headline, 40),
          moods: context.monthMoods ?? [],
          stats: [
            { label: t('Records', undefined, 'model'), value: String(facts.captures) },
            { label: t('Closed', undefined, 'model'), value: String(facts.done) },
            { label: t('New'), value: String(facts.itemsTotal) },
          ],
        },
        {
          id: 'phrase',
          type: 'text',
          label: t('The month in one phrase'),
          eyebrow,
          title: t('The month in one phrase'),
          body: truncate(phraseBody ? `${headline}. ${phraseBody}` : headline, 360),
          glow,
        },
        {
          id: 'metrics',
          type: 'metrics',
          label: t('Numbers of the month: {recordsLine}', { recordsLine }),
          eyebrow,
          title: t('The month in numbers'),
          hero: { value: String(facts.captures), label: t('records this month') },
          metrics: monthMetrics,
          ...(compare && {
            compare: {
              caption: compare.full ? t('The whole month') : t('By day {dayOfMonth}', { dayOfMonth: compare.dayOfMonth }),
              nowLabel: t('Now'),
              now: compare.now,
              beforeLabel: capitalize(compare.beforeMonth),
              before: compare.before,
            },
          }),
          glow,
        },
        winsSlide(review, facts, t('What went well')),
        overdueSlide(review, facts, t('What is still pending')) ?? patternsPeopleSlide(review, facts),
      ]).slice(0, 5);
    }
    case 'year': {
      const year = Number(review.startDay.slice(0, 4));
      const issuedOn = context.today >= review.startDay && context.today <= review.endDay ? context.today : review.endDay;
      return compact<SlideSpec>([
        {
          id: 'cover',
          type: 'cover',
          label: t('Year {year}', { year }),
          eyebrow: t('Year summary'),
          word: String(year),
          title: truncate(headline, 80),
          subtitle: t('{recordsLine}, {daysCount} with records', { recordsLine, daysCount: daysCount(facts.activeDays) }),
          glow,
        },
        {
          id: 'passport',
          type: 'passport',
          label: t('Passport of {year}', { year }),
          year,
          hero: { value: facts.captures, label: t('records') },
          stats: [
            { label: t('Days', undefined, 'model'), value: facts.activeDays },
            { label: t('Closed', undefined, 'model'), value: facts.done },
            { label: t('Decisions'), value: facts.decisions },
            { label: t('Promises'), value: facts.commitments },
          ],
          issuedOn,
        },
        metrics(t('The year in numbers'), true),
        writtenSlide(review, facts),
        winsSlide(review, facts, t('Main wins')),
        patternsPeopleSlide(review, facts),
        moodSlide(review, facts),
      ]);
    }
  }
}

// ───────── Names ─────────

const SHORT_NAME = 3;

function stemOf(word: string): { stem: string; suffix: number } {
  const chars = [...word];
  if (chars.length <= SHORT_NAME) return { stem: word, suffix: 0 };
  // Russian endings: Анна → Анны/Анне/Анной, Дмитрий → Дмитрия/Дмитрием, Иван → Ивана/Иваном.
  const trimmed = /[аяуюыиеоьй]$/iu.test(word) ? chars.slice(0, -1).join('') : word;
  return { stem: trimmed, suffix: 3 };
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Words of the names worth hiding: whole names, their parts of three letters or more, deduplicated. */
function nameWords(names: readonly string[]): string[] {
  const words = new Set<string>();
  for (const name of names) {
    const clean = name.trim();
    if (clean.length < 2) continue;
    for (const part of clean.split(/[\s,]+/)) {
      const word = part.replace(/^[«"“(]+|[»"”).:;]+$/g, '');
      if ([...word].length >= 2 && /\p{L}/u.test(word)) words.add(word);
    }
  }
  return [...words].sort((a, b) => b.length - a.length);
}

/** One regular expression for all names (case-insensitive, any common Russian ending), or null when there are none. */
export function namePattern(names: readonly string[]): RegExp | null {
  const alternatives = nameWords(names).map((word) => {
    const { stem, suffix } = stemOf(word);
    return `${escapeRegExp(stem)}\\p{L}{0,${suffix}}`;
  });
  if (alternatives.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

/** Replaces every name in the text with a mask. The text is otherwise untouched. */
export function maskNames(text: string, names: readonly string[] | RegExp | null): string {
  const pattern = names instanceof RegExp || names === null ? names : namePattern(names);
  return pattern ? text.replace(pattern, MASK) : text;
}

function mapStrings<T>(value: T, fn: (text: string) => string, key?: string): T {
  if (typeof value === 'string') return (key === 'id' || key === 'type' ? value : fn(value)) as T;
  if (Array.isArray(value)) return value.map((entry) => mapStrings(entry, fn, key)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn, k)])) as T;
  }
  return value;
}

/** The slide with all names hidden: the one that is shown and exported when "Скрыть имена" is on. */
export function maskSlide(spec: SlideSpec, names: readonly string[]): SlideSpec {
  const pattern = namePattern(names);
  return pattern ? mapStrings(spec, (text) => maskNames(text, pattern)) : spec;
}

function collectStrings(value: unknown, out: string[], key?: string): void {
  if (typeof value === 'string') {
    if (key !== 'id' && key !== 'type') out.push(value);
  } else if (Array.isArray(value)) value.forEach((entry) => collectStrings(entry, out, key));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectStrings(v, out, k);
  }
}

/** Whether the slide shows any of the names. */
export function slideHasNames(spec: SlideSpec, names: readonly string[]): boolean {
  const pattern = namePattern(names);
  if (!pattern) return false;
  const texts: string[] = [];
  collectStrings(spec, texts);
  return texts.some((text) => new RegExp(pattern.source, 'iu').test(text));
}

/** Names of the people a review mentions: the people table plus what the sections carry. */
export function reviewNames(review: Review, people: readonly { name: string; aliases?: readonly string[] }[]): string[] {
  const names = new Set<string>();
  for (const person of people) {
    names.add(person.name);
    for (const alias of person.aliases ?? []) names.add(alias);
  }
  const peopleData = findSection(review, 'people')?.data;
  if (Array.isArray(peopleData)) {
    for (const entry of peopleData) if (typeof rec(entry)?.name === 'string') names.add(rec(entry)?.name as string);
  }
  const overdueData = findSection(review, 'overdue')?.data;
  if (Array.isArray(overdueData)) {
    for (const entry of overdueData) if (typeof rec(entry)?.person === 'string') names.add(rec(entry)?.person as string);
  }
  return [...names].filter((name) => name.trim().length >= 2);
}

// ───────── Helpers for the list screen ─────────

/** The title of a review in lists. */
export function reviewTitle(review: Pick<Review, 'period' | 'startDay' | 'endDay'>): string {
  return periodTitle(review.period, review.startDay, review.endDay);
}

/** "Заполнено 2 из 3" counter text for the answers. */
export function answersSummary(review: Pick<Review, 'questions' | 'answers'>): string | undefined {
  if (review.questions.length === 0) return undefined;
  const answered = review.questions.filter((question) => review.answers?.some((answer) => answer.question === question && answer.answer.trim() !== '')).length;
  return t('Answered {answered} of {count}', { answered, count: review.questions.length });
}

/** The anchor day that makes the review of `period` containing `day` (the start of its range). */
export function periodStart(period: ReviewPeriod, day: DayKey): DayKey {
  return periodRange(period, day).startDay;
}

export function dayLabel(day: DayKey): string {
  return formatDayShort(day);
}
