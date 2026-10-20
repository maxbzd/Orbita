import type { Profile } from '../../domain/types';
import { allTables } from '../internal';
import { deleteDemoData } from '../maintenance';
import { recomputeMentions } from '../repos/people';
import { PROFILE_ID } from '../repos/profile';
import { db } from '../schema';
import { buildDemoDataset } from './build';
import type { DemoDataset, DemoOptions } from './build';
import { buildDemoProfile } from './content/profile';
import { DEFAULT_DEMO_DAYS, MAX_DEMO_DAYS } from './context';

/**
 * Demo data: a freelance designer who is building a small invoicing product, over the last two months. Dates are relative to "now", every record carries `isDemo: true`.
 */
export { buildDemoDataset, DEFAULT_DEMO_DAYS, MAX_DEMO_DAYS };
export type { DemoDataset, DemoOptions };
export { DemoContentError } from './errors';

export interface DemoSeedResult {
  captures: number;
  items: number;
  people: number;
  projects: number;
  checkins: number;
  patterns: number;
  reviews: number;
  links: number;
  /** False when the user already had their own profile, which the demo never overwrites. */
  profileSeeded: boolean;
}

const isBlank = (value: string): boolean => value.trim() === '';

/** A profile the user has not filled in. */
function isEmptyProfile(profile: Profile): boolean {
  return (
    [profile.name, profile.about, profile.goals, profile.values, profile.talkStyle].every(isBlank) &&
    profile.glossary.length === 0
  );
}

/** Same content, timestamps aside. */
function sameProfileContent(a: Profile, b: Profile): boolean {
  const text = (profile: Profile) => [profile.name, profile.about, profile.goals, profile.values, profile.talkStyle];
  const glossary = (profile: Profile) => profile.glossary.map((entry) => `${entry.term}\u0000${entry.hint ?? ''}`);
  return JSON.stringify([text(a), glossary(a)]) === JSON.stringify([text(b), glossary(b)]);
}

/**
 * Loads the demo set, replacing a demo set loaded earlier (so "Сегодня" is current again). Other
 * records are never touched: a real weekly review for the same week keeps its place, and the demo
 * profile is written only into an empty one. All or nothing: it is one transaction.
 */
export async function seedDemo(options: DemoOptions = {}): Promise<DemoSeedResult> {
  const dataset = buildDemoDataset(options);
  let kept: DemoDataset = dataset;
  let profileSeeded = false;

  await db.transaction('rw', allTables(), async () => {
    await deleteDemoData();

    const realWeeks = new Set(
      (await db.reviews.filter((review) => review.deletedAt === undefined).toArray()).map(
        (review) => `${review.period}|${review.startDay}`,
      ),
    );
    const replaced = dataset.reviews.filter((review) => realWeeks.has(`${review.period}|${review.startDay}`));
    const replacedAnswers = new Set(
      replaced.flatMap((review) => (review.answers ?? []).flatMap((answer) => (answer.captureId ? [answer.captureId] : []))),
    );
    kept = {
      ...dataset,
      reviews: dataset.reviews.filter((review) => !replaced.includes(review)),
      captures: dataset.captures.filter((capture) => !replacedAnswers.has(capture.id)),
    };

    await db.projects.bulkPut(kept.projects);
    await db.people.bulkPut(kept.people);
    await db.captures.bulkPut(kept.captures);
    await db.items.bulkPut(kept.items);
    await db.checkins.bulkPut(kept.checkins);
    await db.patterns.bulkPut(kept.patterns);
    await db.reviews.bulkPut(kept.reviews);
    await db.links.bulkPut(kept.links);
    // Invariant 4: the database is the authority on the mention counters.
    await recomputeMentions(kept.people.map((person) => person.id));

    const existing = await db.profile.get(PROFILE_ID);
    if (!existing || isEmptyProfile(existing)) {
      await db.profile.put(dataset.profile);
      profileSeeded = true;
    }
  });

  return {
    captures: kept.captures.length,
    items: kept.items.length,
    people: kept.people.length,
    projects: kept.projects.length,
    checkins: kept.checkins.length,
    patterns: kept.patterns.length,
    reviews: kept.reviews.length,
    links: kept.links.length,
    profileSeeded,
  };
}

/**
 * Removes the demo set and nothing else: every `isDemo` record goes (see `deleteDemoData`), and the
 * profile goes too if it is still the demo one. Returns the number of removed records.
 */
export async function removeDemo(): Promise<number> {
  const removed = await deleteDemoData();
  const profile = await db.profile.get(PROFILE_ID);
  if (profile && sameProfileContent(profile, buildDemoProfile(profile.updatedAt))) {
    await db.profile.delete(PROFILE_ID);
    return removed + 1;
  }
  return removed;
}
