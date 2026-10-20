import { describe, expect, it } from 'vitest';
import { calibrationReport } from '../../domain/calibration';
import { addDays, diffDays, localDayKey, startOfWeek, weekdayIndex } from '../../domain/dates';
import {
  captureSchema,
  checkInSchema,
  itemSchema,
  linkSchema,
  patternSchema,
  personSchema,
  profileSchema,
  projectSchema,
  reviewSchema,
} from '../../domain/schemas';
import { countWords } from '../../domain/text';
import type { Capture, ItemKind, ItemOfKind } from '../../domain/types';
import { buildDemoDataset } from './build';
import type { DemoDataset } from './build';
import { DemoContentError } from './errors';
import { setLocale } from '../../i18n';
import { demoId } from './random';

/** Local Thursday, mid-afternoon: today has room for the morning's captures. */
const NOW = new Date(2026, 9, 8, 14, 30, 0);
const NOW_ISO = NOW.toISOString();
const TODAY = localDayKey(NOW);

const data = buildDemoDataset({ now: NOW });

const ofKind = <K extends ItemKind>(dataset: DemoDataset, kind: K): ItemOfKind<K>[] =>
  dataset.items.filter((item): item is ItemOfKind<K> => item.kind === kind);

const captureById = (dataset: DemoDataset): Map<string, Capture> => new Map(dataset.captures.map((capture) => [capture.id, capture]));

/** Every id a record points at must belong to a record of the dataset. Returns the offenders. */
function danglingReferences(dataset: DemoDataset): string[] {
  const captures = new Set(dataset.captures.map((capture) => capture.id));
  const people = new Set(dataset.people.map((person) => person.id));
  const projects = new Set(dataset.projects.map((project) => project.id));
  const items = new Set(dataset.items.map((item) => item.id));
  const problems: string[] = [];
  const need = (set: Set<string>, id: string | undefined, where: string): void => {
    if (id !== undefined && !set.has(id)) problems.push(`${where} -> ${id}`);
  };

  for (const capture of dataset.captures) {
    capture.personIds.forEach((id) => need(people, id, `capture ${capture.title} person`));
    capture.projectIds.forEach((id) => need(projects, id, `capture ${capture.title} project`));
  }
  for (const item of dataset.items) {
    const where = `item ${item.title}`;
    need(captures, item.captureId, `${where} capture`);
    item.personIds.forEach((id) => need(people, id, `${where} person`));
    item.projectIds.forEach((id) => need(projects, id, `${where} project`));
    need(items, item.duplicateOf, `${where} duplicateOf`);
    if (item.kind === 'commitment') need(people, item.counterpartyId, `${where} counterparty`);
    if (item.kind === 'idea') item.relatedIds.forEach((id) => need(items, id, `${where} related`));
    if (item.kind === 'fact') need(items, item.supersededBy, `${where} supersededBy`);
  }
  for (const checkIn of dataset.checkins) need(captures, checkIn.captureId, `check-in ${checkIn.day} capture`);
  for (const pattern of dataset.patterns) pattern.evidence.forEach((entry) => need(captures, entry.captureId, `pattern ${pattern.title}`));
  for (const review of dataset.reviews) review.answers?.forEach((answer) => need(captures, answer.captureId, `review ${review.startDay}`));
  for (const link of dataset.links) {
    need(items, link.from, 'link from');
    need(items, link.to, 'link to');
  }
  return problems;
}

describe('buildDemoDataset: determinism', () => {
  it('gives identical records for the same now and days', () => {
    const again = buildDemoDataset({ now: new Date(NOW.getTime()) });
    expect(again).toEqual(data);
    expect(JSON.stringify(again)).toBe(JSON.stringify(data));
  });

  it('derives stable ids from keys and keeps them unique across all tables', () => {
    expect(demoId('capture:x')).toBe(demoId('capture:x'));
    expect(demoId('capture:x')).not.toBe(demoId('capture:y'));
    expect(demoId('capture:x')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const all = [
      ...data.captures,
      ...data.items,
      ...data.people,
      ...data.projects,
      ...data.checkins,
      ...data.patterns,
      ...data.reviews,
      ...data.links,
    ].map((record) => record.id);
    expect(new Set(all).size).toBe(all.length);
  });

  it('moves every date with now: shifting by whole days shifts the story by the same number of days', () => {
    const shift = 10;
    const later = buildDemoDataset({ now: new Date(2026, 9, 8 + shift, 14, 30, 0) });

    expect(later.captures.map((capture) => capture.id).sort()).toEqual(data.captures.map((capture) => capture.id).sort());
    const laterCaptures = captureById(later);
    // Answers to the weekly reviews follow the week boundaries, not the number of days.
    for (const capture of data.captures.filter((entry) => entry.kind !== 'review_answer')) {
      expect(laterCaptures.get(capture.id)?.day, capture.title).toBe(addDays(capture.day, shift));
    }

    const laterItems = new Map(later.items.map((item) => [item.id, item]));
    for (const item of data.items) {
      const moved = laterItems.get(item.id);
      expect(moved, item.title).toBeDefined();
      expect(localDayKey(moved!.createdAt), item.title).toBe(addDays(localDayKey(item.createdAt), shift));
      if (item.dueAt) expect(localDayKey(moved!.dueAt!), item.title).toBe(addDays(localDayKey(item.dueAt), shift));
    }

    const laterCheckIns = new Map(later.checkins.map((checkIn) => [checkIn.id, checkIn]));
    expect(laterCheckIns.size).toBe(data.checkins.length);
    for (const checkIn of data.checkins) expect(laterCheckIns.get(checkIn.id)?.day).toBe(addDays(checkIn.day, shift));
  });
});

describe('buildDemoDataset: volume and variety', () => {
  it('has the requested amount of every kind of record', () => {
    expect(data.captures.length).toBeGreaterThanOrEqual(44);
    expect(data.captures.length).toBeLessThanOrEqual(52);
    expect(data.people.length).toBeGreaterThanOrEqual(11);
    expect(data.people.length).toBeLessThanOrEqual(14);
    expect(data.projects.length).toBeGreaterThanOrEqual(4);
    expect(data.projects.length).toBeLessThanOrEqual(5);
    const decisionsAndCommitments = ofKind(data, 'decision').length + ofKind(data, 'commitment').length;
    expect(decisionsAndCommitments).toBeGreaterThanOrEqual(35);
    expect(ofKind(data, 'idea').length).toBeGreaterThanOrEqual(15);
    expect(ofKind(data, 'idea').length).toBeLessThanOrEqual(30);
    expect(ofKind(data, 'prediction').length).toBeGreaterThanOrEqual(18);
    expect(ofKind(data, 'prediction').length).toBeLessThanOrEqual(26);
    for (const kind of ['task', 'question', 'lesson', 'fact'] as const) {
      expect(ofKind(data, kind).length, kind).toBeGreaterThanOrEqual(5);
    }
    expect(data.checkins.length).toBeGreaterThanOrEqual(45);
    expect(data.checkins.length).toBeLessThanOrEqual(60);
    expect(data.patterns.length).toBeGreaterThanOrEqual(4);
    expect(data.patterns.length).toBeLessThanOrEqual(6);
    expect(data.reviews).toHaveLength(2);
  });

  it('covers every capture kind, context and processing state a screen needs', () => {
    const kinds = new Set(data.captures.map((capture) => capture.kind));
    expect([...kinds].sort()).toEqual(['ai_chat', 'checkin', 'review_answer', 'text', 'voice']);
    expect(new Set(data.captures.map((capture) => capture.context))).toEqual(new Set(['walk', 'home', 'transit', 'work', 'other']));
    expect(data.captures.filter((capture) => capture.status === 'review').length).toBeGreaterThanOrEqual(2);
    expect(data.captures.filter((capture) => capture.status === 'transcribed').length).toBeGreaterThanOrEqual(1);
    expect(data.captures.filter((capture) => capture.pinned).length).toBeGreaterThanOrEqual(3);
  });

  it('has items at every stage: proposed, active, done, dropped, and ideas from spark to dropped', () => {
    const statuses = new Set(data.items.map((item) => item.status));
    for (const status of ['proposed', 'active', 'done', 'dropped'] as const) expect(statuses.has(status), status).toBe(true);
    expect(new Set(ofKind(data, 'idea').map((idea) => idea.stage))).toEqual(
      new Set(['spark', 'exploring', 'doing', 'parked', 'dropped']),
    );
    expect(data.items.some((item) => item.duplicateOf !== undefined)).toBe(true);
    expect(ofKind(data, 'fact').some((fact) => fact.supersededBy !== undefined)).toBe(true);
    expect(data.links.length).toBeGreaterThanOrEqual(10);
  });

  it('has people in every role the story needs, with aliases', () => {
    const roles = new Set(data.people.map((person) => person.role));
    for (const role of ['client', 'student', 'teacher', 'partner', 'teammate', 'mentor', 'friend', 'family', 'lead'] as const) {
      expect(roles.has(role), role).toBe(true);
    }
    expect(data.people.filter((person) => person.aliases.length > 0).length).toBeGreaterThanOrEqual(10);
    expect(data.people.every((person) => person.relationMood !== undefined && Math.abs(person.relationMood) <= 1)).toBe(true);
  });

  it('writes lively text: voice notes of different length, numbers, no placeholders', () => {
    const voice = data.captures.filter((capture) => capture.kind === 'voice');
    const words = voice.map((capture) => countWords(capture.text));
    expect(voice.length).toBeGreaterThanOrEqual(20);
    expect(Math.min(...words)).toBeLessThan(80);
    expect(Math.max(...words)).toBeGreaterThan(200);
    const durations = voice.map((capture) => capture.durationSec ?? 0);
    expect(Math.min(...durations)).toBeGreaterThanOrEqual(15);
    expect(Math.max(...durations)).toBeGreaterThan(150);
    expect(data.captures.reduce((sum, capture) => sum + countWords(capture.text), 0)).toBeGreaterThan(3500);

    for (const capture of data.captures) {
      expect(capture.text, capture.title).toMatch(/[а-яё]/i);
      expect(`${capture.title} ${capture.summary} ${capture.text}`, capture.title).not.toMatch(/lorem|todo|placeholder/i);
    }
    expect(data.captures.some((capture) => /\d{2,}/.test(capture.text))).toBe(true);
    expect(voice.filter((capture) => capture.rawText !== capture.text).length).toBeGreaterThanOrEqual(5);
  });

  it('ships the profile with a glossary', () => {
    expect(() => profileSchema.parse(data.profile)).not.toThrow();
    expect(data.profile.name).not.toBe('');
    const terms = data.profile.glossary.map((entry) => entry.term);
    for (const term of ['Lumen', 'MRR', 'CAC', 'LTV', 'OKR']) expect(terms).toContain(term);
    expect(data.profile.glossary.length).toBeGreaterThanOrEqual(10);
    expect(data.profile.about.length).toBeGreaterThan(50);
  });
});

describe('buildDemoDataset: contract', () => {
  it('marks every record as demo and none as deleted', () => {
    const records = [...data.captures, ...data.items, ...data.people, ...data.projects, ...data.checkins, ...data.patterns, ...data.reviews];
    expect(records.every((record) => record.isDemo === true && record.deletedAt === undefined)).toBe(true);
  });

  it('passes the zod schemas of every table', () => {
    for (const capture of data.captures) expect(() => captureSchema.parse(capture), capture.title).not.toThrow();
    for (const item of data.items) expect(() => itemSchema.parse(item), item.title).not.toThrow();
    for (const person of data.people) expect(() => personSchema.parse(person), person.name).not.toThrow();
    for (const project of data.projects) expect(() => projectSchema.parse(project), project.name).not.toThrow();
    for (const checkIn of data.checkins) expect(() => checkInSchema.parse(checkIn), checkIn.day).not.toThrow();
    for (const pattern of data.patterns) expect(() => patternSchema.parse(pattern), pattern.title).not.toThrow();
    for (const review of data.reviews) expect(() => reviewSchema.parse(review), review.headline).not.toThrow();
    for (const link of data.links) expect(() => linkSchema.parse(link)).not.toThrow();
  });

  it('has no dangling references (every id exists)', () => {
    expect(danglingReferences(data)).toEqual([]);
  });

  it('quotes are verbatim substrings of their capture and quoteStart points at them', () => {
    const captures = captureById(data);
    const sourced = data.items.filter((item) => item.captureId !== undefined);
    expect(sourced.length).toBeGreaterThanOrEqual(data.items.length - 3);
    for (const item of sourced) {
      const capture = captures.get(item.captureId!);
      expect(capture, item.title).toBeDefined();
      expect(item.quote, item.title).toBeTruthy();
      expect(Number.isInteger(item.quoteStart) && item.quoteStart! >= 0, item.title).toBe(true);
      expect(capture!.text.slice(item.quoteStart, item.quoteStart! + item.quote!.length), item.title).toBe(item.quote);
    }
    // Invariant 2: an item made from a capture always keeps both; manual ones have neither.
    for (const item of data.items.filter((entry) => entry.captureId === undefined)) {
      expect(item.quote).toBeUndefined();
      expect(item.quoteStart).toBeUndefined();
    }
  });

  it('pattern evidence quotes come from real captures on the right day', () => {
    const captures = captureById(data);
    for (const pattern of data.patterns) {
      expect(pattern.evidence.length, pattern.title).toBeGreaterThanOrEqual(2);
      for (const entry of pattern.evidence) {
        const capture = captures.get(entry.captureId);
        expect(capture, pattern.title).toBeDefined();
        expect(entry.quote && capture!.text.includes(entry.quote), `${pattern.title}: ${entry.quote}`).toBe(true);
        expect(entry.day).toBe(capture!.day);
      }
      const days = pattern.evidence.map((entry) => entry.day).sort();
      expect(pattern.firstSeenDay).toBe(days[0]);
      expect(pattern.lastSeenDay).toBe(days[days.length - 1]);
      expect(pattern.occurrences).toBeGreaterThanOrEqual(pattern.evidence.length);
      expect(pattern.confidence).toBeGreaterThan(0);
      expect(pattern.confidence).toBeLessThanOrEqual(1);
    }
    const statuses = new Set(data.patterns.map((pattern) => pattern.status));
    expect(statuses.has('candidate') && statuses.has('confirmed')).toBe(true);
  });

  it('respects the invariants of DATA_MODEL.md', () => {
    // 1. proposed items wait on a capture that is still in review.
    const reviewCaptures = new Set(data.captures.filter((capture) => capture.status === 'review').map((capture) => capture.id));
    const proposed = data.items.filter((item) => item.status === 'proposed');
    expect(proposed.length).toBeGreaterThanOrEqual(5);
    for (const item of proposed) expect(reviewCaptures.has(item.captureId!), item.title).toBe(true);
    for (const id of reviewCaptures) expect(proposed.some((item) => item.captureId === id)).toBe(true);

    // 4. mention counters are exactly what recomputeMentions derives.
    for (const person of data.people) {
      const mentions = data.captures.filter((capture) => capture.personIds.includes(person.id));
      expect(person.mentionCount, person.name).toBe(mentions.length);
      expect(person.lastMentionAt, person.name).toBe(mentions.map((capture) => capture.createdAt).sort().pop());
    }

    // 5. probability in [0.01, 0.99]; an outcome sets resolvedAt.
    for (const prediction of ofKind(data, 'prediction')) {
      expect(prediction.probability, prediction.title).toBeGreaterThanOrEqual(0.01);
      expect(prediction.probability, prediction.title).toBeLessThanOrEqual(0.99);
      expect(prediction.resolvedAt !== undefined, prediction.title).toBe(prediction.outcome !== undefined);
      expect(prediction.resolvesAt, prediction.title).toBe(prediction.dueAt);
    }
    for (const decision of ofKind(data, 'decision')) expect(decision.reviewAt, decision.title).toBe(decision.dueAt);

    // Titles fit, done items know when, timestamps run forward.
    for (const item of data.items) {
      expect(item.title.length, item.title).toBeLessThanOrEqual(120);
      expect(item.updatedAt >= item.createdAt, item.title).toBe(true);
      expect(item.doneAt !== undefined, item.title).toBe(item.status === 'done');
      if (item.doneAt) expect(item.doneAt >= item.createdAt, item.title).toBe(true);
    }
    for (const capture of data.captures) expect(capture.updatedAt >= capture.createdAt).toBe(true);
    for (const capture of data.captures) expect(capture.day, capture.title).toBe(localDayKey(capture.createdAt));
    for (const checkIn of data.checkins) expect(checkIn.day).toBe(localDayKey(checkIn.at));
  });

  it('keeps related kinds consistent with their captures', () => {
    const checkIns = new Map(data.checkins.map((checkIn) => [checkIn.captureId, checkIn]));
    for (const capture of data.captures.filter((entry) => entry.kind === 'checkin')) {
      expect(checkIns.has(capture.id), capture.title).toBe(true);
    }
    for (const capture of data.captures.filter((entry) => entry.kind === 'ai_chat')) {
      expect(capture.source?.importedFrom, capture.title).toBeDefined();
      expect(capture.text).toMatch(/^Я: /);
    }
    for (const capture of data.captures.filter((entry) => entry.kind === 'voice')) {
      expect(capture.durationSec, capture.title).toBeGreaterThan(0);
    }
    const pending = data.checkins.filter((checkIn) => checkIn.origin === 'ai_suggested');
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(data.checkins.some((checkIn) => checkIn.origin === 'ai_confirmed')).toBe(true);
    expect(data.checkins.some((checkIn) => checkIn.origin === 'manual')).toBe(true);
  });
});

describe('buildDemoDataset: the timeline relative to now', () => {
  it('has nothing from the future and reaches back about two months', () => {
    const instants: string[] = [];
    for (const capture of data.captures) instants.push(capture.createdAt, capture.updatedAt, ...(capture.processedAt ? [capture.processedAt] : []));
    for (const item of data.items) {
      instants.push(item.createdAt, item.updatedAt, ...(item.doneAt ? [item.doneAt] : []));
      if (item.kind === 'prediction' && item.resolvedAt) instants.push(item.resolvedAt);
      if (item.kind === 'decision' && item.outcome) instants.push(item.outcome.at);
    }
    for (const checkIn of data.checkins) instants.push(checkIn.at, checkIn.createdAt);
    for (const record of [...data.people, ...data.projects, ...data.patterns, ...data.reviews, ...data.links]) instants.push(record.createdAt);
    expect(instants.filter((instant) => instant > NOW_ISO)).toEqual([]);

    const days = data.captures.map((capture) => capture.day).sort();
    expect(days[days.length - 1]).toBe(TODAY);
    expect(diffDays(days[0], TODAY)).toBeGreaterThanOrEqual(55);
    expect(diffDays(days[0], TODAY)).toBeLessThanOrEqual(59);
  });

  it('keeps "Сегодня" alive: captures today, a streak of days, activity growing over time', () => {
    const countOn = (day: string): number => data.captures.filter((capture) => capture.day === day).length;
    expect(countOn(TODAY)).toBeGreaterThanOrEqual(2);
    for (let back = 0; back < 7; back += 1) expect(countOn(addDays(TODAY, -back)), `${back} days ago`).toBeGreaterThanOrEqual(1);

    const within = (from: number, to: number): number =>
      data.captures.filter((capture) => {
        const ago = diffDays(capture.day, TODAY);
        return ago >= from && ago <= to;
      }).length;
    expect(within(0, 13)).toBeGreaterThanOrEqual(18);
    expect(within(0, 20)).toBeGreaterThan(within(39, 59));
  });

  it('has the right things burning: overdue, due soon, due later and closed, in both directions', () => {
    const commitments = ofKind(data, 'commitment');
    const open = commitments.filter((item) => item.status === 'active');
    const overdue = open.filter((item) => item.dueAt && item.dueAt < NOW_ISO);
    expect(overdue.length).toBeGreaterThanOrEqual(3);
    expect(overdue.some((item) => item.direction === 'i_owe')).toBe(true);
    expect(overdue.some((item) => item.direction === 'owed_to_me')).toBe(true);
    expect(open.filter((item) => item.dueAt && item.dueAt > NOW_ISO).length).toBeGreaterThanOrEqual(3);
    for (const direction of ['i_owe', 'owed_to_me'] as const) {
      expect(commitments.filter((item) => item.direction === direction && item.status === 'done').length, direction).toBeGreaterThanOrEqual(3);
      expect(open.filter((item) => item.direction === direction).length, direction).toBeGreaterThanOrEqual(3);
    }
    expect(commitments.some((item) => item.counterpartyName !== undefined && item.counterpartyId === undefined)).toBe(true);
    expect(commitments.some((item) => item.status === 'dropped')).toBe(true);

    const decisions = ofKind(data, 'decision');
    expect(decisions.filter((item) => item.outcome !== undefined).length).toBeGreaterThanOrEqual(3);
    expect(decisions.filter((item) => item.status === 'active' && !item.outcome && item.dueAt && item.dueAt < NOW_ISO).length).toBeGreaterThanOrEqual(1);
    expect(decisions.filter((item) => item.status === 'active' && item.dueAt && item.dueAt > NOW_ISO).length).toBeGreaterThanOrEqual(5);

    const predictions = ofKind(data, 'prediction');
    const openPredictions = predictions.filter((item) => item.status === 'active');
    expect(openPredictions.filter((item) => item.resolvesAt! < NOW_ISO).length).toBeGreaterThanOrEqual(1);
    expect(openPredictions.filter((item) => item.resolvesAt! > NOW_ISO).length).toBeGreaterThanOrEqual(3);

    const tasks = ofKind(data, 'task');
    expect(tasks.filter((item) => item.status === 'active' && item.scheduledFor === TODAY).length).toBeGreaterThanOrEqual(2);
    expect(tasks.some((item) => item.status === 'done')).toBe(true);
    expect(ofKind(data, 'question').some((item) => item.answer !== undefined)).toBe(true);
    expect(ofKind(data, 'question').some((item) => item.status === 'active' && item.answer === undefined)).toBe(true);
  });

  it('spreads check-ins over the whole window and ties mood to short nights and deadlines', () => {
    const days = data.checkins.map((checkIn) => checkIn.day).sort();
    expect(diffDays(days[0], TODAY)).toBeGreaterThanOrEqual(55);
    expect(days[days.length - 1]).toBe(TODAY);

    const withSleep = data.checkins.filter((checkIn) => checkIn.sleepHours !== undefined);
    const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
    const short = withSleep.filter((checkIn) => checkIn.sleepHours! < 6);
    const rested = withSleep.filter((checkIn) => checkIn.sleepHours! >= 7);
    expect(short.length).toBeGreaterThanOrEqual(5);
    expect(rested.length).toBeGreaterThanOrEqual(5);
    expect(mean(short.map((checkIn) => checkIn.energy))).toBeLessThan(mean(rested.map((checkIn) => checkIn.energy)) - 0.15);
    expect(mean(short.map((checkIn) => checkIn.valence))).toBeLessThan(mean(rested.map((checkIn) => checkIn.valence)));
    expect(mean(short.map((checkIn) => checkIn.stress ?? 0))).toBeGreaterThan(mean(rested.map((checkIn) => checkIn.stress ?? 0)));

    // The story's own peaks: the olympiad week is hard, the rested morning is the best.
    const worst = [...data.checkins].sort((a, b) => a.valence - b.valence)[0];
    expect(worst.valence).toBeLessThan(-0.4);
    expect(Math.max(...data.checkins.map((checkIn) => checkIn.valence))).toBeGreaterThan(0.8);
  });

  it('gives a sensible calibration picture with mild overconfidence', () => {
    const report = calibrationReport(ofKind(data, 'prediction'));
    expect(report.enough).toBe(true);
    if (!report.enough) return;
    expect(report.closed).toBeGreaterThanOrEqual(14);
    expect(report.brier).toBeGreaterThan(0.12);
    expect(report.brier).toBeLessThan(0.26);
    expect(report.hitRate).toBeGreaterThan(0.4);
    expect(report.hitRate).toBeLessThan(0.7);
    expect(report.bias).toBeGreaterThan(0.03);
    expect(report.bias).toBeLessThan(0.2);
    expect(report.buckets.filter((bucket) => bucket.count > 0).length).toBeGreaterThanOrEqual(6);
    // "Said 80-90%, came true less often" must be visible somewhere in the upper half.
    const upper = report.buckets.filter((bucket) => bucket.from >= 0.6 && bucket.count > 0);
    expect(upper.some((bucket) => bucket.observedRate! < bucket.meanProbability! - 0.1)).toBe(true);
    // One prediction was closed as "unknown" and is not scored.
    expect(ofKind(data, 'prediction').some((item) => item.outcome === 'unknown')).toBe(true);
  });

  it('writes two weekly reviews for the last two complete weeks, with answers', () => {
    const thisWeek = startOfWeek(TODAY);
    const [older, newer] = [...data.reviews].sort((a, b) => a.startDay.localeCompare(b.startDay));
    expect(newer.startDay).toBe(addDays(thisWeek, -7));
    expect(newer.endDay).toBe(addDays(thisWeek, -1));
    expect(older.startDay).toBe(addDays(thisWeek, -14));
    for (const review of data.reviews) {
      expect(review.period).toBe('week');
      expect(weekdayIndex(review.startDay)).toBe(0);
      expect(weekdayIndex(review.endDay)).toBe(6);
      expect(review.headline.length).toBeGreaterThan(10);
      expect(review.headline.length).toBeLessThanOrEqual(90);
      expect(review.sections.length).toBeGreaterThanOrEqual(5);
      expect(new Set(review.sections.map((section) => section.id)).size).toBe(review.sections.length);
      expect(review.sections.every((section) => section.body.trim() !== '')).toBe(true);
      expect(review.questions.length).toBeGreaterThanOrEqual(3);
      expect(review.answers!.length).toBeGreaterThanOrEqual(1);
      expect(review.answers!.length).toBeLessThan(review.questions.length);
    }
    expect(new Set(data.reviews.map((review) => review.generatedBy))).toEqual(new Set(['ai', 'rules']));

    const captures = captureById(data);
    for (const review of data.reviews) {
      for (const answer of review.answers!) {
        const capture = captures.get(answer.captureId!);
        expect(capture?.kind).toBe('review_answer');
        expect(capture?.text).toBe(answer.answer);
        expect(review.questions).toContain(answer.question);
        expect(capture!.day >= addDays(review.endDay, 1)).toBe(true);
      }
    }
    expect(data.captures.filter((capture) => capture.kind === 'review_answer')).toHaveLength(
      data.reviews.reduce((sum, review) => sum + review.answers!.length, 0),
    );
  });
});

describe('buildDemoDataset: window and options', () => {
  it('works for shorter and longer windows without dangling references', () => {
    for (const days of [1, 7, 14, 30, 45, 120]) {
      const dataset = buildDemoDataset({ now: NOW, days });
      expect(danglingReferences(dataset), `days=${days}`).toEqual([]);
      const oldest = addDays(TODAY, -(days - 1));
      for (const capture of dataset.captures) expect(capture.day >= oldest, `days=${days} ${capture.title}`).toBe(true);
      for (const checkIn of dataset.checkins) expect(checkIn.day >= oldest, `days=${days}`).toBe(true);
      for (const review of dataset.reviews) expect(review.startDay >= oldest, `days=${days}`).toBe(true);
      for (const person of dataset.people) expect(person.mentionCount, `days=${days} ${person.name}`).toBeGreaterThan(0);
      for (const pattern of dataset.patterns) expect(pattern.evidence.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps today alive even for a one-day window and scales the history with the window', () => {
    const one = buildDemoDataset({ now: NOW, days: 1 });
    expect(one.captures.length).toBeGreaterThanOrEqual(2);
    expect(one.captures.every((capture) => capture.day === TODAY)).toBe(true);

    const short = buildDemoDataset({ now: NOW, days: 30 });
    const long = buildDemoDataset({ now: NOW, days: 120 });
    expect(short.captures.length).toBeLessThan(data.captures.length);
    expect(short.items.length).toBeLessThan(data.items.length);
    expect(long.captures.length).toBe(data.captures.length);
    expect(long.checkins.length).toBeGreaterThan(data.checkins.length + 30);
  });

  it('rejects a window that makes no sense', () => {
    for (const days of [0, -5, 1.5, 366, Number.NaN]) {
      expect(() => buildDemoDataset({ now: NOW, days }), String(days)).toThrow(RangeError);
    }
    expect(() => buildDemoDataset({ now: 'not a date' })).toThrow(RangeError);
  });

  it('stays valid when "now" is early in the morning or right after midnight', () => {
    for (const now of [new Date(2026, 9, 8, 0, 20), new Date(2026, 9, 8, 6, 5), new Date(2026, 9, 5, 23, 55), new Date(2026, 9, 12, 9, 0)]) {
      const dataset = buildDemoDataset({ now });
      const nowIso = now.toISOString();
      expect(danglingReferences(dataset)).toEqual([]);
      expect(dataset.captures.length).toBeGreaterThanOrEqual(44);
      expect(dataset.reviews).toHaveLength(2);
      const stamps = [
        ...dataset.captures.map((capture) => capture.updatedAt),
        ...dataset.items.map((item) => item.updatedAt),
        ...dataset.checkins.map((checkIn) => checkIn.at),
        ...dataset.reviews.map((review) => review.updatedAt),
        ...dataset.patterns.map((pattern) => pattern.updatedAt),
      ];
      expect(stamps.filter((stamp) => stamp > nowIso)).toEqual([]);
    }
  });

  it('reports content errors loudly', () => {
    const error = new DemoContentError(['первая', 'вторая']);
    expect(error.message).toContain('- первая');
    expect(error.message).toContain('- вторая');
    expect(error.problems).toHaveLength(2);
  });
});

describe('buildDemoDataset in English', () => {
  const english = (() => {
    setLocale('en');
    try {
      return buildDemoDataset({ now: NOW });
    } finally {
      setLocale('ru');
    }
  })();

  it('builds the same story with the same structure', () => {
    expect(english.captures).toHaveLength(data.captures.length);
    expect(english.items).toHaveLength(data.items.length);
    expect(english.people).toHaveLength(data.people.length);
    expect(english.reviews).toHaveLength(data.reviews.length);
    expect(english.items.map((item) => item.id)).toEqual(data.items.map((item) => item.id));
  });

  it('is written in English, from the title to the glossary', () => {
    const texts = [
      ...english.captures.flatMap((capture) => [capture.title, capture.summary, capture.text]),
      ...english.items.map((item) => item.title),
      ...english.people.flatMap((person) => [person.name, person.notes ?? '']),
      ...english.patterns.map((pattern) => pattern.title),
      ...english.reviews.flatMap((review) => [review.headline, ...review.sections.map((section) => section.body)]),
      english.profile.about,
      ...english.profile.glossary.map((entry) => entry.hint ?? ''),
    ];
    for (const text of texts) expect(text).not.toMatch(/[а-яё]/i);
  });

  it('keeps every quote verbatim in its capture', () => {
    const byId = captureById(english);
    for (const item of english.items) {
      if (item.quote === undefined || item.captureId === undefined) continue;
      const capture = byId.get(item.captureId);
      expect(capture?.text.slice(item.quoteStart, item.quoteStart! + item.quote.length), item.title).toBe(item.quote);
    }
  });
});
