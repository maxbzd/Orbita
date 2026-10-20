import type { Capture, Item, Person, Project } from '../domain/types';

/** Builders of valid records for tests: only what a test cares about is spelled out. */

const CREATED = '2026-10-01T10:00:00.000Z';

export function makeCapture(overrides: Partial<Capture> & Pick<Capture, 'id'>): Capture {
  return {
    kind: 'text',
    day: '2026-10-01',
    text: '',
    projectIds: [],
    personIds: [],
    tags: [],
    status: 'transcribed',
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

/** An item of any kind: pass the kind-specific fields (`chosen`, `direction`, …) in `overrides`. */
export function makeItem(overrides: { id: string; title: string } & Record<string, unknown>): Item {
  return {
    kind: 'task',
    status: 'active',
    personIds: [],
    projectIds: [],
    tags: [],
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  } as Item;
}

export function makePerson(overrides: Partial<Person> & Pick<Person, 'id' | 'name'>): Person {
  return { aliases: [], role: 'other', mentionCount: 0, createdAt: CREATED, updatedAt: CREATED, ...overrides };
}

export function makeProject(overrides: Partial<Project> & Pick<Project, 'id' | 'name'>): Project {
  return { kind: 'business', status: 'active', keywords: [], createdAt: CREATED, updatedAt: CREATED, ...overrides };
}
