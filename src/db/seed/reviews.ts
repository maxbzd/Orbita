import { addDays, diffDays, localDayKey, shiftPeriod } from '../../domain/dates';
import type { DayRange } from '../../domain/dates';
import { daysCount, predictionsCount, recordsCount, timesCount } from '../../domain/counts';
import { collate, pick, t } from '../../i18n';
import { countWords } from '../../domain/text';
import type {
  Capture,
  CheckIn,
  DayKey,
  Item,
  ItemOfKind,
  Pattern,
  Person,
  PersonRole,
  Review,
  ReviewSection,
} from '../../domain/types';
import { reviewContent } from './content/reviews';
import type { DemoReviewContent } from './content/reviews';
import { ids } from './context';
import type { SeedContext } from './context';
import { DemoContentError } from './errors';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

const roleLabels = (): Record<PersonRole, string> =>
  pick(
    { student: 'student', parent: 'parent', lead: 'lead', teacher: 'teacher', partner: 'partner', teammate: 'teammate', client: 'client', friend: 'friend', family: 'family', mentor: 'mentor', other: 'other' },
    { student: 'ученик', parent: 'родитель', lead: 'лид', teacher: 'преподаватель', partner: 'партнёр', teammate: 'коллега', client: 'клиент', friend: 'друг', family: 'семья', mentor: 'ментор', other: 'другое' },
  );

const patternStatusLabels = () =>
  pick(
    { candidate: 'candidate', confirmed: 'confirmed', rejected: 'dismissed', resolved: 'resolved' } as const,
    { candidate: 'кандидат', confirmed: 'подтверждён', rejected: 'отклонён', resolved: 'решено' } as const,
  );

const groupThousands = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, pick(',', ' '));
const percent = (value: number): number => Math.round(value * 100);
const signed = (value: number): string => `${value >= 0 ? '+' : '−'}${pick(Math.abs(value).toFixed(1), Math.abs(value).toFixed(1).replace('.', ','))}`;
const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
const bullets = (lines: readonly string[]): string => lines.map((line) => `• ${line}`).join('\n');

export interface ReviewInput {
  captures: readonly Capture[];
  items: readonly Item[];
  checkIns: readonly CheckIn[];
  patterns: readonly Pattern[];
  people: readonly Person[];
}

export interface BuiltReviews {
  reviews: Review[];
  /** The user's answers to the reviews' questions, stored as `review_answer` captures. */
  answerCaptures: Capture[];
}

/** Last day an item stopped being open, if it did. */
function closedDay(item: Item): DayKey | undefined {
  if (item.status === 'done' && item.doneAt) return localDayKey(item.doneAt);
  if (item.status === 'dropped') return localDayKey(item.updatedAt);
  return undefined;
}

class Week {
  readonly captures: Capture[];
  readonly checkIns: CheckIn[];

  constructor(
    readonly range: DayRange,
    readonly input: ReviewInput,
  ) {
    this.captures = input.captures.filter((capture) => this.has(capture.day));
    this.checkIns = input.checkIns.filter((checkIn) => this.has(checkIn.day));
  }

  has(day: DayKey): boolean {
    return day >= this.range.startDay && day <= this.range.endDay;
  }
}

function statsSection(week: Week): ReviewSection {
  const { captures } = week;
  const count = (predicate: (capture: Capture) => boolean): number => captures.filter(predicate).length;
  const voice = count((capture) => capture.kind === 'voice');
  const chats = count((capture) => capture.kind === 'ai_chat');
  const written = count((capture) => capture.kind === 'text' || capture.kind === 'checkin');
  const words = captures.reduce((sum, capture) => sum + countWords(capture.text), 0);
  const voiceMinutes = Math.round(captures.reduce((sum, capture) => sum + (capture.durationSec ?? 0), 0) / 60);
  const activeDays = new Set(captures.map((capture) => capture.day)).size;
  const created = week.input.items.filter(
    (item) => week.has(localDayKey(item.createdAt)) && item.status !== 'proposed' && item.status !== 'dismissed',
  );
  return {
    id: 'stats',
    title: t('The week in numbers'),
    kind: 'stats',
    body: t('{records}: {voice} voice, {written} written, {chats} AI chats. {words} words, about {voiceMinutes} min of voice. Days with records: {activeDays} of 7. New objects: {items}.', {
      records: recordsCount(captures.length),
      voice,
      written,
      chats,
      words: groupThousands(words),
      voiceMinutes,
      activeDays,
      items: created.length,
    }),
    data: { captures: captures.length, voice, written, chats, words, voiceMinutes, activeDays, items: created.length },
  };
}

function winsSection(week: Week): ReviewSection | undefined {
  const rank = { decision: 0, prediction: 1, commitment: 2, task: 3, question: 4 } as const;
  const wins = week.input.items
    .filter((item) => {
      const day = closedDay(item);
      if (item.status !== 'done' || day === undefined || !week.has(day)) return false;
      if (item.kind === 'prediction') return item.outcome === 'true';
      return item.kind in rank;
    })
    .sort((a, b) => rank[a.kind as keyof typeof rank] - rank[b.kind as keyof typeof rank] || a.createdAt.localeCompare(b.createdAt))
    .slice(0, 4);
  if (wins.length === 0) return undefined;
  const lines = wins.map((item) => {
    switch (item.kind) {
      case 'decision':
        return item.outcome ? t('{title} (result {rating} of 5)', { title: item.title, rating: item.outcome.rating }) : item.title;
      case 'prediction':
        return t('Prediction came true: {title}', { title: item.title });
      case 'commitment':
        return item.direction === 'i_owe' ? t('Fulfilled: {title}', { title: item.title }) : t('Received: {title}', { title: item.title });
      case 'question':
        return t('Answer found: {title}', { title: item.title });
      default:
        return item.title;
    }
  });
  return { id: 'wins', title: t('What worked'), kind: 'wins', body: bullets(lines), data: { itemIds: wins.map((item) => item.id) } };
}

function overdueSection(week: Week): ReviewSection | undefined {
  const late = week.input.items
    .filter((item): item is ItemOfKind<'commitment'> => item.kind === 'commitment' && item.dueAt !== undefined)
    .filter((item) => {
      const closed = closedDay(item);
      return (
        item.status !== 'proposed' &&
        item.status !== 'dismissed' &&
        localDayKey(item.createdAt) <= week.range.endDay &&
        localDayKey(item.dueAt as string) < week.range.endDay &&
        (closed === undefined || closed > week.range.endDay)
      );
    })
    .map((item) => ({ item, days: diffDays(localDayKey(item.dueAt as string), week.range.endDay) }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 3);
  if (late.length === 0) return undefined;
  const lines = late.map(
    ({ item, days }) =>
      t('{who}: {title}. By the end of the week it is overdue by {days}', { who: item.direction === 'i_owe' ? t('I owe') : t('Owed to me'), title: item.title, days: daysCount(days) }),
  );
  return { id: 'overdue', title: t('What is stuck'), kind: 'overdue', body: bullets(lines), data: { itemIds: late.map(({ item }) => item.id) } };
}

function patternsSection(week: Week): ReviewSection | undefined {
  const seen = week.input.patterns
    .map((pattern) => ({ pattern, count: pattern.evidence.filter((entry) => week.has(entry.day)).length }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count || b.pattern.confidence - a.pattern.confidence)
    .slice(0, 3);
  if (seen.length === 0) return undefined;
  const lines = seen.map(
    ({ pattern, count }) =>
      t('{title}: {times} this week, {status}', { title: pattern.title, times: timesCount(count), status: patternStatusLabels()[pattern.status] }),
  );
  return {
    id: 'patterns',
    title: t('What repeats'),
    kind: 'patterns',
    body: bullets(lines),
    data: { patternIds: seen.map(({ pattern }) => pattern.id) },
  };
}

function peopleSection(week: Week): ReviewSection | undefined {
  const counts = new Map<string, number>();
  for (const capture of week.captures) {
    for (const personId of capture.personIds) counts.set(personId, (counts.get(personId) ?? 0) + 1);
  }
  const top = week.input.people
    .map((person) => ({ person, count: counts.get(person.id) ?? 0 }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count || collate(a.person.name, b.person.name))
    .slice(0, 3);
  if (top.length === 0) return undefined;
  const lines = top.map(({ person, count }) => `${person.name} (${roleLabels()[person.role]}): ${recordsCount(count)}`);
  return { id: 'people', title: t('People of the week'), kind: 'people', body: bullets(lines), data: { personIds: top.map(({ person }) => person.id) } };
}

function calibrationSection(week: Week): ReviewSection | undefined {
  const closed = week.input.items.filter(
    (item): item is ItemOfKind<'prediction'> =>
      item.kind === 'prediction' &&
      (item.outcome === 'true' || item.outcome === 'false') &&
      item.resolvedAt !== undefined &&
      week.has(localDayKey(item.resolvedAt)),
  );
  if (closed.length === 0) return undefined;
  const hits = closed.filter((item) => item.outcome === 'true').length;
  const stated = percent(mean(closed.map((item) => item.probability)));
  const real = percent(hits / closed.length);
  const note = closed.length >= 3 && stated - real >= 10 ? t(' A little overconfidence: you expected more than you got.') : '';
  return {
    id: 'calibration',
    title: t('Predictions'),
    kind: 'calibration',
    body: t('Closed {predictions}, {hits} came true. You gave {stated}% on average, {real}% came true.{note}', { predictions: predictionsCount(closed.length), hits, stated, real, note }),
    data: { itemIds: closed.map((item) => item.id), stated, real },
  };
}

function moodSection(week: Week, previous: readonly CheckIn[]): ReviewSection | undefined {
  const { checkIns } = week;
  if (checkIns.length === 0) return undefined;
  const valence = mean(checkIns.map((checkIn) => checkIn.valence));
  const energy = mean(checkIns.map((checkIn) => checkIn.energy));
  const stress = mean(checkIns.flatMap((checkIn) => (checkIn.stress === undefined ? [] : [checkIn.stress])));
  const shortNights = checkIns.filter((checkIn) => checkIn.sleepHours !== undefined && checkIn.sleepHours < 6).length;
  let trend = '';
  if (previous.length > 0) {
    const delta = valence - mean(previous.map((checkIn) => checkIn.valence));
    if (delta >= 0.1) trend = t(', better than the week before');
    else if (delta <= -0.1) trend = t(', worse than the week before');
  }
  return {
    id: 'mood',
    title: t('State'),
    kind: 'mood',
    body: t('Mood averaged {mood} on a scale from −1 to +1{trend}. Energy {energy}%, stress {stress}. Nights shorter than six hours: {shortNights}.', {
      mood: signed(valence),
      trend,
      energy: percent(energy),
      stress: Number.isNaN(stress) ? t('not logged') : `${percent(stress)}%`,
      shortNights,
    }),
    data: { days: checkIns.map((checkIn) => ({ day: checkIn.day, valence: checkIn.valence, energy: checkIn.energy })) },
  };
}

function mainSection(week: Week, content: DemoReviewContent): ReviewSection {
  const tagCounts = new Map<string, number>();
  for (const capture of week.captures) {
    for (const tag of capture.tags) if (tag !== pick('AI chat', 'ИИ-чат')) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1] || collate(a[0], b[0]))
    .slice(0, 3)
    .map(([tag]) => tag);
  const themes = topTags.length > 0 ? t(' You returned most often to: {tags}.', { tags: topTags.join(', ') }) : '';
  return { id: 'main', title: t('Main points'), kind: 'text', body: `${content.anchorText}${themes}`, data: { themes: topTags } };
}

function sectionsFor(week: Week, content: DemoReviewContent): ReviewSection[] {
  const previous = week.input.checkIns.filter((checkIn) => {
    const day = checkIn.day;
    return day >= addDays(week.range.startDay, -7) && day < week.range.startDay;
  });
  const main = mainSection(week, content);
  const parts =
    content.generatedBy === 'ai'
      ? [main, statsSection(week), winsSection(week), overdueSection(week), moodSection(week, previous), calibrationSection(week), patternsSection(week), peopleSection(week)]
      : [statsSection(week), winsSection(week), overdueSection(week), patternsSection(week), peopleSection(week), calibrationSection(week), moodSection(week, previous), main];
  return parts.filter((section): section is ReviewSection => section !== undefined);
}

/** The weekly reviews of the two last complete weeks, written from the seeded records. */
export function buildReviews(ctx: SeedContext, input: ReviewInput): BuiltReviews {
  const now = ctx.clock.now.getTime();
  const reviews: Review[] = [];
  const answerCaptures: Capture[] = [];

  for (const content of reviewContent()) {
    const range = shiftPeriod('week', ctx.clock.today, -content.weeksBack);
    const anchor = input.captures.find((capture) => capture.id === ids.capture(content.anchorCap));
    if (range.startDay < ctx.firstDay || !anchor) continue;
    if (anchor.day < range.startDay || anchor.day > range.endDay) {
      throw new DemoContentError([`Review of week ${content.weeksBack}: capture ${content.anchorCap} (${anchor.day}) is outside the week ${range.startDay}…${range.endDay}`]);
    }

    const week = new Week(range, input);
    const createdMs = Math.min(
      ctx.clock.local(addDays(range.endDay, 1), '08:10').getTime(),
      now - 120 * MS_PER_MINUTE,
    );

    const answers: NonNullable<Review['answers']> = [];
    let updatedMs = createdMs;
    content.answers.forEach((answer, index) => {
      const wanted = createdMs + (index === 0 ? 9 : 26) * MS_PER_HOUR;
      const at = new Date(Math.min(wanted, now - (30 - 10 * index) * MS_PER_MINUTE));
      const createdAt = at.toISOString();
      const question = content.questions[answer.question];
      const capture: Capture = {
        id: ids.capture(`ans-w${content.weeksBack}-q${answer.question}`),
        createdAt,
        updatedAt: createdAt,
        isDemo: true,
        kind: 'review_answer',
        day: localDayKey(at),
        title: answer.title,
        summary: question,
        text: answer.text,
        context: 'home',
        projectIds: [],
        personIds: [],
        tags: [pick('review', 'обзор')],
        status: 'done',
        processedAt: createdAt,
      };
      answerCaptures.push(capture);
      answers.push({ question, answer: answer.text, captureId: capture.id });
      updatedMs = Math.max(updatedMs, at.getTime());
    });

    reviews.push({
      id: ids.review(`week-${content.weeksBack}`),
      createdAt: new Date(createdMs).toISOString(),
      updatedAt: new Date(updatedMs).toISOString(),
      isDemo: true,
      period: 'week',
      startDay: range.startDay,
      endDay: range.endDay,
      headline: content.headlineLead,
      sections: sectionsFor(week, content),
      questions: [...content.questions],
      answers,
      generatedBy: content.generatedBy,
    });
  }

  return { reviews, answerCaptures };
}
