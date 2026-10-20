import type { DateInput } from '../../domain/dates';
import type { Capture, CheckIn, Item, Link, Pattern, Person, Profile, Project, Review } from '../../domain/types';
import { buildCaptures } from './captures';
import { buildCheckIns } from './checkins';
import { peopleSpecs } from './content/people';
import { buildDemoProfile } from './content/profile';
import { DEFAULT_DEMO_DAYS, createContext, ids } from './context';
import { buildPeople, buildProjects } from './entities';
import { buildItems } from './items';
import { buildLinks } from './links';
import { buildPatterns } from './patterns';
import { buildReviews } from './reviews';
import { validateContent } from './validate';

export interface DemoOptions {
  /** The moment "now" for the data; every date is relative to it. Defaults to the current time. */
  now?: DateInput;
  /** How many days of history to cover (the authored story is 59 days long). Default 60. */
  days?: number;
}

/** Everything the demo consists of, as plain records (nothing is written anywhere). */
export interface DemoDataset {
  captures: Capture[];
  items: Item[];
  people: Person[];
  projects: Project[];
  checkins: CheckIn[];
  patterns: Pattern[];
  reviews: Review[];
  links: Link[];
  profile: Profile;
}

const byCreatedAt = <T extends { createdAt: string }>(a: T, b: T): number => a.createdAt.localeCompare(b.createdAt);

/** Items may only point at people who exist in this window; a commitment keeps the name instead. */
function dropMissingPeople(items: Item[], people: readonly Person[]): Item[] {
  const present = new Set(people.map((person) => person.id));
  return items.map((item) => {
    const personIds = item.personIds.filter((id) => present.has(id));
    if (item.kind !== 'commitment' || item.counterpartyId === undefined || present.has(item.counterpartyId)) {
      return { ...item, personIds };
    }
    const { counterpartyId, ...rest } = item;
    const name = peopleSpecs().find((spec) => ids.person(spec.key) === counterpartyId)?.name;
    return { ...rest, personIds, ...(name && { counterpartyName: name }) };
  });
}

/**
 * Builds the demo set: a freelance designer building a small software product over the last `days` days.
 * Pure and deterministic: the same `now` and `days` always give the same records, and moving `now`
 * by whole days moves every date with it.
 */
export function buildDemoDataset({ now = new Date(), days = DEFAULT_DEMO_DAYS }: DemoOptions = {}): DemoDataset {
  validateContent();
  const ctx = createContext(now, days);

  const authored = buildCaptures(ctx);
  const people = buildPeople(authored);
  const items = dropMissingPeople(buildItems(ctx, authored), people).sort(byCreatedAt);
  const checkins = buildCheckIns(ctx, authored);
  const patterns = buildPatterns(ctx, authored);
  const { reviews, answerCaptures } = buildReviews(ctx, { captures: authored, items, checkIns: checkins, patterns, people });

  return {
    captures: [...authored, ...answerCaptures].sort(byCreatedAt),
    items,
    people,
    projects: buildProjects(ctx, authored),
    checkins,
    patterns: patterns.sort(byCreatedAt),
    reviews: reviews.sort(byCreatedAt),
    links: buildLinks(ctx, items),
    profile: buildDemoProfile(ctx.clock.now.toISOString()),
  };
}
