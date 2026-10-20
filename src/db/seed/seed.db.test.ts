import { beforeEach, describe, expect, it } from 'vitest';
import { addDays, localDayKey, startOfWeek } from '../../domain/dates';
import { hasDemoData, wipeAll } from '../maintenance';
import { capturesRepo, checkinsRepo, itemsRepo, patternsRepo, peopleRepo, profileRepo, projectsRepo, reviewsRepo } from '../repos';
import { db } from '../schema';
import { buildDemoDataset } from './build';
import { removeDemo, seedDemo } from './index';

beforeEach(wipeAll);

/** Every table the demo can touch, as plain arrays. */
async function snapshot() {
  return {
    captures: await db.captures.orderBy('id').toArray(),
    items: await db.items.orderBy('id').toArray(),
    people: await db.people.orderBy('id').toArray(),
    projects: await db.projects.orderBy('id').toArray(),
    checkins: await db.checkins.orderBy('id').toArray(),
    patterns: await db.patterns.orderBy('id').toArray(),
    reviews: await db.reviews.orderBy('id').toArray(),
    links: await db.links.orderBy('id').toArray(),
    tombstones: await db.tombstones.orderBy('id').toArray(),
    profile: await db.profile.toArray(),
  };
}

/** A small set of the user's own records, linked to each other. */
async function createRealRecords() {
  const person = await peopleRepo.create({ name: 'Реальный Человек', role: 'friend' });
  const project = await projectsRepo.create({ name: 'Реальный проект', kind: 'personal' });
  const capture = await capturesRepo.create({
    kind: 'text',
    text: 'Моя настоящая запись про Реального Человека.',
    personIds: [person.id],
    projectIds: [project.id],
    createdAt: '2020-01-08T10:00:00.000Z',
  });
  const task = await itemsRepo.create({ kind: 'task', title: 'Настоящая задача', captureId: capture.id, quote: 'настоящая запись', quoteStart: 4 });
  const checkIn = await checkinsRepo.create({ valence: 0.1, energy: 0.5, at: '2020-01-08T11:00:00.000Z' });
  const pattern = await patternsRepo.create({ title: 'Настоящий паттерн', description: 'Что-то повторяется', kind: 'other' });
  const review = await reviewsRepo.upsert({ period: 'week', startDay: '2020-01-06', endDay: '2020-01-12', headline: 'Настоящий обзор' });
  return { person, project, capture, task, checkIn, pattern, review };
}

describe('seedDemo', () => {
  it('writes the whole dataset and reports what it wrote', async () => {
    const now = new Date();
    const expected = buildDemoDataset({ now });
    const result = await seedDemo({ now });

    expect(result).toEqual({
      captures: expected.captures.length,
      items: expected.items.length,
      people: expected.people.length,
      projects: expected.projects.length,
      checkins: expected.checkins.length,
      patterns: expected.patterns.length,
      reviews: expected.reviews.length,
      links: expected.links.length,
      profileSeeded: true,
    });
    expect(await db.captures.count()).toBe(expected.captures.length);
    expect(await db.items.count()).toBe(expected.items.length);
    expect(await db.links.count()).toBe(expected.links.length);
    expect(await db.captures.orderBy('id').toArray()).toEqual([...expected.captures].sort((a, b) => a.id.localeCompare(b.id)));
    expect(await hasDemoData()).toBe(true);
    expect((await profileRepo.get()).name).toBe(expected.profile.name);
  });

  it('keeps invariant 4: the mention counters in the database are the derived ones', async () => {
    await seedDemo();
    const people = await peopleRepo.list();
    expect(people.length).toBeGreaterThanOrEqual(11);
    for (const person of people) {
      const mentions = await db.captures.where('personIds').equals(person.id).toArray();
      expect(person.mentionCount, person.name).toBe(mentions.length);
      expect(person.lastMentionAt, person.name).toBe(mentions.map((capture) => capture.createdAt).sort().pop());
    }
  });

  it('feeds the screens through the repositories as of the day it was loaded', async () => {
    await seedDemo();
    const today = localDayKey();

    const inbox = await capturesRepo.listInbox();
    expect(inbox.length).toBeGreaterThanOrEqual(3);
    const feed = await capturesRepo.listFeed();
    expect(feed[0].day).toBe(today);
    expect(feed.length).toBeGreaterThanOrEqual(35);

    expect((await itemsRepo.listProposed()).length).toBeGreaterThanOrEqual(5);
    expect((await itemsRepo.countProposed())).toBe((await itemsRepo.listProposed()).length);
    const owedByMe = await itemsRepo.listOpenCommitments('i_owe');
    const owedToMe = await itemsRepo.listOpenCommitments('owed_to_me');
    expect(owedByMe.length).toBeGreaterThanOrEqual(5);
    expect(owedToMe.length).toBeGreaterThanOrEqual(3);
    expect(owedByMe[0].dueAt! < new Date().toISOString()).toBe(true);

    expect((await itemsRepo.listPredictionsToResolve()).length).toBeGreaterThanOrEqual(1);
    expect((await itemsRepo.listDecisionsToReview()).length).toBeGreaterThanOrEqual(1);

    const counts = await capturesRepo.countsByDay(addDays(today, -59), today);
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(40);
    expect((await checkinsRepo.latest())?.day).toBe(today);
    expect((await patternsRepo.list({ status: 'confirmed' })).length).toBeGreaterThanOrEqual(3);
    expect((await patternsRepo.list({ status: 'candidate' })).length).toBeGreaterThanOrEqual(1);

    const thisWeek = startOfWeek(today);
    const lastWeek = await reviewsRepo.find('week', addDays(thisWeek, -7));
    expect(lastWeek?.generatedBy).toBe('ai');
    expect((await reviewsRepo.list({ period: 'week' })).length).toBe(2);
  });

  it('is idempotent and refreshes the dates when loaded again', async () => {
    const first = new Date(2026, 9, 8, 14, 30);
    const later = new Date(2026, 9, 18, 14, 30);
    await seedDemo({ now: first });
    const before = await snapshot();
    await seedDemo({ now: first });
    expect(await snapshot()).toEqual(before);

    await seedDemo({ now: later });
    const after = await snapshot();
    expect(after.captures.length).toBe(before.captures.length);
    expect(after.items.length).toBe(before.items.length);
    expect(after.people.length).toBe(before.people.length);
    const newestDay = (await capturesRepo.list({ limit: 1 }))[0].day;
    expect(newestDay).toBe(localDayKey(later));
    expect(after.tombstones).toEqual([]);
  });

  it('covers a custom window', async () => {
    const now = new Date(2026, 9, 8, 14, 30);
    const expected = buildDemoDataset({ now, days: 21 });
    const result = await seedDemo({ now, days: 21 });
    expect(result.captures).toBe(expected.captures.length);
    expect(await db.captures.count()).toBe(expected.captures.length);
    expect(await db.checkins.count()).toBe(expected.checkins.length);
    const oldest = (await db.captures.orderBy('day').first())!;
    expect(oldest.day >= addDays(localDayKey(now), -20)).toBe(true);
  });

  it('leaves the database untouched when the options are invalid', async () => {
    await seedDemo();
    const before = await snapshot();
    await expect(seedDemo({ days: 0 })).rejects.toThrow(RangeError);
    expect(await snapshot()).toEqual(before);
  });

  it('never overwrites the profile the user filled in', async () => {
    await profileRepo.save({ name: 'Настоящее Имя', about: 'Пишу о себе сам', glossary: [{ term: 'мой термин' }] });
    const mine = await profileRepo.get();
    const result = await seedDemo();
    expect(result.profileSeeded).toBe(false);
    expect(await profileRepo.get()).toEqual(mine);
  });

  it('keeps the real weekly review of a week the demo also covers', async () => {
    const now = new Date(2026, 9, 8, 14, 30);
    const demoReview = buildDemoDataset({ now }).reviews.find((review) => review.generatedBy === 'ai')!;
    const real = await reviewsRepo.upsert({ period: 'week', startDay: demoReview.startDay, endDay: demoReview.endDay, headline: 'Мой настоящий обзор' });

    const result = await seedDemo({ now });
    expect(result.reviews).toBe(1);
    const sameWeek = await db.reviews.where('[period+startDay]').equals(['week', demoReview.startDay]).toArray();
    expect(sameWeek).toHaveLength(1);
    expect(sameWeek[0].id).toBe(real.id);
    expect(await db.captures.where('kind').equals('review_answer').count()).toBe(2);
  });
});

describe('removeDemo', () => {
  it('removes every demo record and nothing the user made', async () => {
    const real = await createRealRecords();
    await profileRepo.save({ name: 'Настоящее Имя', about: 'Пишу о себе сам' });
    const mine = await snapshot();

    await seedDemo();
    expect(await db.captures.count()).toBeGreaterThan(mine.captures.length);

    const removed = await removeDemo();
    expect(removed).toBeGreaterThan(250);
    expect(await hasDemoData()).toBe(false);
    expect(await snapshot()).toEqual(mine);
    expect(await peopleRepo.get(real.person.id)).toMatchObject({ mentionCount: 1 });
  });

  it('empties the database it filled, links and tombstones included', async () => {
    await seedDemo();
    await removeDemo();
    const rest = await snapshot();
    expect(rest).toEqual({
      captures: [],
      items: [],
      people: [],
      projects: [],
      checkins: [],
      patterns: [],
      reviews: [],
      links: [],
      tombstones: [],
      profile: [],
    });
  });

  it('removes the demo profile only while it is still the demo one', async () => {
    await seedDemo();
    expect((await profileRepo.get()).name).not.toBe('');
    await removeDemo();
    expect(await db.profile.count()).toBe(0);

    await seedDemo();
    await profileRepo.save({ about: 'Дописал про себя после загрузки демо' });
    const edited = await profileRepo.get();
    await removeDemo();
    expect(await profileRepo.get()).toEqual(edited);
  });

  it('does nothing on an empty database', async () => {
    expect(await removeDemo()).toBe(0);
    expect(await hasDemoData()).toBe(false);
  });

  it('can be followed by a fresh load', async () => {
    const first = await seedDemo();
    await removeDemo();
    const second = await seedDemo();
    expect(second).toEqual(first);
    expect(await hasDemoData()).toBe(true);
  });
});
