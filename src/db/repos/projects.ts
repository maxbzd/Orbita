import { nowISO } from '../../domain/dates';
import { newId } from '../../domain/ids';
import { rankByName } from '../../domain/names';
import type { NameMatchReason } from '../../domain/names';
import type { ID, Project, ProjectStatus } from '../../domain/types';
import {
  allTables,
  hardDelete,
  isLive,
  notDeleted,
  patchRecord,
  restoreRecord,
  softDeleteRecord,
} from '../internal';
import { db } from '../schema';
import { t } from '../../i18n';

type Managed = 'updatedAt' | 'deletedAt';

/** Defaults: `kind` other, `status` active, no keywords. */
export type NewProject = Pick<Project, 'name'> & Partial<Omit<Project, 'name' | Managed>>;
export type ProjectPatch = Partial<Omit<Project, 'id' | 'createdAt' | Managed>>;

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') throw new RangeError(t('The project name cannot be empty'));
  return trimmed;
}

export async function create(input: NewProject): Promise<Project> {
  const createdAt = input.createdAt ?? nowISO();
  const project: Project = {
    ...input,
    id: input.id ?? newId(),
    createdAt,
    updatedAt: createdAt,
    name: cleanName(input.name),
    kind: input.kind ?? 'other',
    status: input.status ?? 'active',
    keywords: input.keywords ?? [],
  };
  await db.projects.add(project);
  return project;
}

export async function get(id: ID): Promise<Project | undefined> {
  return db.projects.get(id);
}

export async function getMany(ids: readonly ID[]): Promise<Project[]> {
  return (await db.projects.bulkGet([...ids])).filter(isLive);
}

export async function update(id: ID, patch: ProjectPatch): Promise<Project> {
  return patchRecord('projects', id, patch, (next) => ({ ...next, name: cleanName(next.name) }));
}

const STATUS_ORDER: Record<ProjectStatus, number> = { active: 0, paused: 1, done: 2 };

/** Active projects first, then paused, then finished; by name inside a group. */
export async function list({ status }: { status?: ProjectStatus } = {}): Promise<Project[]> {
  const projects = await db.projects.filter((project) => notDeleted(project) && (!status || project.status === status)).toArray();
  return projects.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name, 'ru'));
}

export interface ProjectMatch {
  project: Project;
  score: number;
  reason: NameMatchReason;
}

/** Projects whose name or keywords match `query`, best first (see `rankByName` for the scores). */
export async function findByName(query: string): Promise<ProjectMatch[]> {
  const candidates = (await list()).map((project) => ({ project, name: project.name, aliases: project.keywords }));
  return rankByName(query, candidates).map(({ entity, score, reason }) => ({ project: entity.project, score, reason }));
}

export async function remove(id: ID): Promise<Project> {
  return softDeleteRecord('projects', id);
}

export async function restore(id: ID): Promise<Project> {
  return restoreRecord('projects', id);
}

/** Deletes a project for good (trash purge) and removes it from captures, items and presets. */
export async function destroy(id: ID): Promise<void> {
  await db.transaction('rw', allTables(), async () => {
    const without = (ids: readonly ID[]) => ids.filter((projectId) => projectId !== id);
    await db.captures.where('projectIds').equals(id).modify((capture) => {
      capture.projectIds = without(capture.projectIds);
    });
    await db.items.where('projectIds').equals(id).modify((item) => {
      item.projectIds = without(item.projectIds);
    });
    await db.presets.filter((preset) => preset.projectIds.includes(id)).modify((preset) => {
      preset.projectIds = without(preset.projectIds);
    });
    await hardDelete('projects', id);
  });
}
