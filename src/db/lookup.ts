import type { Capture, CheckIn, ID, Item, Pattern, Person, Project, Review } from '../domain/types';
import { db } from './schema';

/** Any entity found by id, tagged with the table it lives in. */
export type EntityRef =
  | { table: 'captures'; record: Capture }
  | { table: 'items'; record: Item }
  | { table: 'people'; record: Person }
  | { table: 'projects'; record: Project }
  | { table: 'checkins'; record: CheckIn }
  | { table: 'patterns'; record: Pattern }
  | { table: 'reviews'; record: Review };

/** Ids are globally unique, so a link or a citation can point at any entity: this finds it (trashed ones too). */
export async function findById(id: ID): Promise<EntityRef | undefined> {
  const [capture, item, person, project, checkIn, pattern, review] = await Promise.all([
    db.captures.get(id),
    db.items.get(id),
    db.people.get(id),
    db.projects.get(id),
    db.checkins.get(id),
    db.patterns.get(id),
    db.reviews.get(id),
  ]);
  if (capture) return { table: 'captures', record: capture };
  if (item) return { table: 'items', record: item };
  if (person) return { table: 'people', record: person };
  if (project) return { table: 'projects', record: project };
  if (checkIn) return { table: 'checkins', record: checkIn };
  if (pattern) return { table: 'patterns', record: pattern };
  if (review) return { table: 'reviews', record: review };
  return undefined;
}
