import { peopleRepo, projectsRepo } from '../db';
import { NAME_SCORE, compareNames, normalizeName } from '../domain/names';
import type { NameMatchReason } from '../domain/names';
import type { ID, Person, PersonRole, Project, ProjectKind } from '../domain/types';
import type { Extraction } from './prompts/schemas';
import { isFullerName, resolveByName } from './resolver';

/**
 * Applies entity resolution to the people and projects of one extraction: links what clearly exists,
 * creates what is new, and reports what the user should look at (ambiguous names, look-alikes to merge).
 */

export interface AmbiguousMention {
  kind: 'person' | 'project';
  name: string;
  candidates: { id: ID; name: string; score: number }[];
}

export interface MergeSuggestion {
  kind: 'person' | 'project';
  created: { id: ID; name: string };
  candidate: { id: ID; name: string };
  score: number;
  reason: NameMatchReason;
}

export interface ResolvedEntities {
  personId(name: string): ID | undefined;
  projectId(name: string): ID | undefined;
  /** Everyone and everything linked to the record, new and old. */
  personIds: ID[];
  projectIds: ID[];
  newPeople: Person[];
  newProjects: Project[];
  ambiguous: AmbiguousMention[];
  mergeHints: MergeSuggestion[];
}

interface PersonMention {
  name: string;
  aliases: string[];
  role: PersonRole;
  sentiment?: number | null;
  note?: string | null;
}

interface ProjectMention {
  name: string;
  kind: ProjectKind;
  keywords: string[];
}

export interface EntityPools {
  /** Archived people included: a mention of one still points at them. */
  people: readonly Person[];
  projects: readonly Project[];
}

export interface EntityOptions {
  /** Move `Person.relationMood` by the tone of this record (only the first time a record is processed). */
  updateRelationMood: boolean;
  /** Names that are not mentions: the author's own. */
  ignoreNames?: readonly string[];
  /** The record is part of the demo set: whoever is created from it is demo too (invariant 6). */
  isDemo?: boolean;
}

/** Weight of a new record in the moving estimate of how things stand with a person. */
const RELATION_MOOD_WEIGHT = 0.3;

const partsCount = (name: string): number => name.trim().split(/[\s-]+/).filter(Boolean).length;
const clampMood = (value: number): number => Math.min(1, Math.max(-1, value));

/** Mentions by normalized name; the richer description (from `people`) wins over a bare name from an object. */
function collectPeople(extraction: Extraction, ignore: readonly string[]): PersonMention[] {
  const byName = new Map<string, PersonMention>();
  const isAuthor = (name: string) => ignore.some((own) => (compareNames(name, own)?.score ?? 0) >= NAME_SCORE.stem);
  const add = (mention: PersonMention) => {
    const name = mention.name.trim();
    const key = normalizeName(name);
    if (key === '' || isAuthor(name)) return;
    if (!byName.has(key)) byName.set(key, { ...mention, name });
  };
  for (const person of extraction.people) {
    add({ name: person.name, aliases: person.aliases, role: person.role, sentiment: person.sentiment, note: person.note });
  }
  for (const item of extraction.items) {
    for (const name of item.people) add({ name, aliases: [], role: 'other' });
    if (item.kind === 'commitment' && item.counterparty) add({ name: item.counterparty, aliases: [], role: 'other' });
  }
  // Longest names first: "Маша Иванова" is created before "Маша" is looked up and finds her.
  return [...byName.values()].sort((a, b) => partsCount(b.name) - partsCount(a.name));
}

function collectProjects(extraction: Extraction): ProjectMention[] {
  const byName = new Map<string, ProjectMention>();
  const add = (mention: ProjectMention) => {
    const name = mention.name.trim();
    const key = normalizeName(name);
    if (key !== '' && !byName.has(key)) byName.set(key, { ...mention, name });
  };
  for (const project of extraction.projects) add({ name: project.name, kind: project.kind, keywords: project.keywords });
  for (const item of extraction.items) for (const name of item.projects) add({ name, kind: 'other', keywords: [] });
  return [...byName.values()];
}

const personEntity = (person: Person) => ({ ...person, aliases: person.aliases });
const projectEntity = (project: Project) => ({ project, name: project.name, aliases: project.keywords });

export async function resolveEntities(extraction: Extraction, pools: EntityPools, options: EntityOptions): Promise<ResolvedEntities> {
  const ambiguous: AmbiguousMention[] = [];
  const mergeHints: MergeSuggestion[] = [];
  const personByName = new Map<string, Person>();
  const projectByName = new Map<string, Project>();
  const newPeople: Person[] = [];
  const newProjects: Project[] = [];

  // ───── People
  let people = [...pools.people];
  /** The newest version of every person touched here (renamed, mood updated). */
  const latest = new Map<ID, Person>();
  const remember = (labels: readonly string[], person: Person) => {
    latest.set(person.id, person);
    for (const label of labels) {
      const key = normalizeName(label);
      if (key !== '' && !personByName.has(key)) personByName.set(key, person);
    }
  };

  for (const mention of collectPeople(extraction, options.ignoreNames ?? [])) {
    const resolution = resolveByName(mention.name, people.map(personEntity));
    let person: Person | undefined;

    if (resolution.status === 'matched') {
      person = people.find((candidate) => candidate.id === resolution.entity.id);
      if (person && isFullerName(mention.name, person.name)) {
        // "Маша" became "Маша Иванова": keep the fuller name, the short one stays as an alias.
        const renamed = await peopleRepo.update(person.id, { name: mention.name, aliases: [...person.aliases, person.name] });
        people = people.map((candidate) => (candidate.id === renamed.id ? renamed : candidate));
        person = renamed;
      }
    } else if (resolution.status === 'ambiguous') {
      ambiguous.push({
        kind: 'person',
        name: mention.name,
        candidates: resolution.candidates.map(({ entity, score }) => ({ id: entity.id, name: entity.name, score })),
      });
    } else {
      const note = mention.note?.trim();
      person = await peopleRepo.create({ name: mention.name, aliases: mention.aliases, role: mention.role, ...(note && { notes: note }), ...(options.isDemo && { isDemo: true }) });
      people.push(person);
      newPeople.push(person);
      for (const similar of resolution.similar) {
        mergeHints.push({
          kind: 'person',
          created: { id: person.id, name: person.name },
          candidate: { id: similar.entity.id, name: similar.entity.name },
          score: similar.score,
          reason: similar.reason,
        });
      }
    }
    if (!person) continue;

    if (options.updateRelationMood && typeof mention.sentiment === 'number' && Number.isFinite(mention.sentiment)) {
      const previous = person.relationMood;
      const next = previous === undefined ? mention.sentiment : previous * (1 - RELATION_MOOD_WEIGHT) + mention.sentiment * RELATION_MOOD_WEIGHT;
      person = await peopleRepo.update(person.id, { relationMood: clampMood(next) });
    }
    remember([mention.name, ...mention.aliases], person);
  }

  // ───── Projects
  const projects = [...pools.projects];
  for (const mention of collectProjects(extraction)) {
    const resolution = resolveByName(mention.name, projects.map(projectEntity));
    let project: Project | undefined;

    if (resolution.status === 'matched') {
      project = resolution.entity.project;
    } else if (resolution.status === 'ambiguous') {
      ambiguous.push({
        kind: 'project',
        name: mention.name,
        candidates: resolution.candidates.map(({ entity, score }) => ({ id: entity.project.id, name: entity.name, score })),
      });
    } else {
      project = await projectsRepo.create({ name: mention.name, kind: mention.kind, keywords: mention.keywords, ...(options.isDemo && { isDemo: true }) });
      projects.push(project);
      newProjects.push(project);
      for (const similar of resolution.similar) {
        mergeHints.push({
          kind: 'project',
          created: { id: project.id, name: project.name },
          candidate: { id: similar.entity.project.id, name: similar.entity.name },
          score: similar.score,
          reason: similar.reason,
        });
      }
    }
    if (project) {
      for (const label of [mention.name, ...mention.keywords]) {
        const key = normalizeName(label);
        if (key !== '' && !projectByName.has(key)) projectByName.set(key, project);
      }
    }
  }

  return {
    personId: (name) => personByName.get(normalizeName(name))?.id,
    projectId: (name) => projectByName.get(normalizeName(name))?.id,
    personIds: [...new Set([...personByName.values()].map((person) => person.id))],
    projectIds: [...new Set([...projectByName.values()].map((project) => project.id))],
    newPeople: newPeople.map((person) => latest.get(person.id) ?? person),
    newProjects,
    ambiguous,
    mergeHints,
  };
}
