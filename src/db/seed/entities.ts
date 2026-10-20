import { uniqueAliases } from '../../domain/names';
import type { Capture, ISODate, Person, Project } from '../../domain/types';
import { peopleSpecs, projectSpecs } from './content/people';
import { ids } from './context';
import type { SeedContext } from './context';
import { plusMinutes } from './time';

/** A person is created half an hour before the first capture that mentions them. */
const PERSON_LEAD_MINUTES = 30;

/**
 * People that the captures actually mention. `mentionCount` and `lastMentionAt` follow invariant 4
 * (live captures that list the person), the same way `recomputeMentions` derives them in the database.
 */
export function buildPeople(captures: readonly Capture[]): Person[] {
  const people: Person[] = [];
  for (const spec of peopleSpecs()) {
    const id = ids.person(spec.key);
    const mentions = captures
      .filter((capture) => capture.deletedAt === undefined && capture.personIds.includes(id))
      .map((capture) => capture.createdAt)
      .sort();
    if (mentions.length === 0) continue;
    const createdAt: ISODate = plusMinutes(mentions[0], -PERSON_LEAD_MINUTES);
    people.push({
      id,
      createdAt,
      updatedAt: mentions[mentions.length - 1],
      isDemo: true,
      name: spec.name,
      aliases: uniqueAliases(spec.name, spec.aliases),
      role: spec.role,
      notes: spec.notes,
      mentionCount: mentions.length,
      lastMentionAt: mentions[mentions.length - 1],
      relationMood: spec.mood,
    });
  }
  return people;
}

export function buildProjects(ctx: SeedContext, captures: readonly Capture[]): Project[] {
  const oldest = captures[0]?.createdAt;
  return projectSpecs().map((spec) => {
    const created = ctx.clock.at({ d: Math.min(spec.startedD, ctx.days - 1), t: '09:00' });
    const createdAt = oldest && oldest < created.toISOString() ? plusMinutes(oldest, -10) : created.toISOString();
    return {
      id: ids.project(spec.key),
      createdAt,
      updatedAt: createdAt,
      isDemo: true,
      name: spec.name,
      kind: spec.kind,
      status: spec.status,
      description: spec.description,
      keywords: [...spec.keywords],
      color: spec.color,
    };
  });
}
