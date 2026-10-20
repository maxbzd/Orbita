import { useMemo, useState } from 'react';
import { usePeople, useProjects } from '../../db/hooks';
import type { Capture, ID, Person, Project } from '../../domain/types';
import type { Job } from '../../state';
import { Button, Caption, Chip, IconButton, Label, TypeMedallion } from '../../ui/primitives';
import { createAndLinkPerson, linkPerson, mergePerson, mergeProject, rejectPerson, rejectProject } from './actions';
import styles from './Review.module.css';
import { t } from '../../i18n';

/** Entities the run created or could not place. Pure, so it can be tested without the database. */
export interface EntityRows {
  newPeople: Array<{ person: Person; mergeInto?: Person }>;
  newProjects: Array<{ project: Project; mergeInto?: Project }>;
  ambiguous: Array<{ kind: 'person' | 'project'; name: string; candidates: Array<{ id: ID; name: string }> }>;
}

/**
 * New people and projects of a capture. The result of the run knows exactly which ones it created and which look like
 * existing ones; after a reload that is gone, so the rows fall back to what the database shows: someone first mentioned
 * by this very capture.
 */
export function entityRows(capture: Capture, people: readonly Person[], projects: readonly Project[], result: Job['result']): EntityRows {
  const personById = new Map(people.map((person) => [person.id, person]));
  const projectById = new Map(projects.map((project) => [project.id, project]));

  const createdPeople = result
    ? result.newPeople.map((created) => personById.get(created.id)).filter((person): person is Person => person !== undefined)
    : people.filter((person) => person.createdAt >= capture.createdAt && person.mentionCount <= 1);
  const createdProjects = result
    ? result.newProjects.map((created) => projectById.get(created.id)).filter((project): project is Project => project !== undefined)
    : projects.filter((project) => project.createdAt >= capture.createdAt);

  const hints = result?.mergeHints ?? [];
  return {
    newPeople: createdPeople
      .filter((person) => capture.personIds.includes(person.id))
      .map((person) => {
        const hint = hints.find((entry) => entry.kind === 'person' && entry.created.id === person.id);
        return { person, mergeInto: hint ? personById.get(hint.candidate.id) : undefined };
      }),
    newProjects: createdProjects
      .filter((project) => capture.projectIds.includes(project.id))
      .map((project) => {
        const hint = hints.find((entry) => entry.kind === 'project' && entry.created.id === project.id);
        return { project, mergeInto: hint ? projectById.get(hint.candidate.id) : undefined };
      }),
    ambiguous: (result?.ambiguous ?? []).map((mention) => ({
      kind: mention.kind,
      name: mention.name,
      candidates: mention.candidates.map(({ id, name }) => ({ id, name })),
    })),
  };
}

/** «Новые люди и проекты»: create or merge, one tap each. Duplicates of existing people are offered as a merge. */
export function EntitiesPanel({ capture, result }: { capture: Capture; result: Job['result'] }) {
  const people = usePeople({ includeArchived: true });
  const projects = useProjects();
  const [settled, setSettled] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => (people && projects ? entityRows(capture, people, projects, result) : undefined), [capture, people, projects, result]);
  if (!rows) return null;

  const settle = (key: string): void => setSettled((current) => new Set(current).add(key));
  const newPeople = rows.newPeople.filter(({ person }) => !settled.has(person.id));
  const newProjects = rows.newProjects.filter(({ project }) => !settled.has(project.id));
  const ambiguous = rows.ambiguous.filter((mention) => !settled.has(`${mention.kind}:${mention.name}`));
  if (newPeople.length + newProjects.length + ambiguous.length === 0) return null;

  return (
    <section className={styles.entities} aria-label={t('New people and projects')} data-testid="entities">
      <Label>{t('New people and projects')}</Label>
      <ul className={styles.entityList}>
        {newPeople.map(({ person, mergeInto }) => (
          <li key={person.id} className={styles.entity}>
            <TypeMedallion kind="person" size={36} />
            <span className={styles.entityText}>
              <span>{person.name}</span>
              <Caption>{t('New person')}</Caption>
            </span>
            {mergeInto ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  settle(person.id);
                  void mergePerson(person.id, mergeInto.id);
                }}
              >
                
                {t('This is {name}', { name: mergeInto.name })}
              </Button>
            ) : null}
            <IconButton
              icon="close"
              label={t('Remove: {name}', { name: person.name })}
              onClick={() => {
                settle(person.id);
                void rejectPerson(person.id, capture.id);
              }}
            />
          </li>
        ))}
        {newProjects.map(({ project, mergeInto }) => (
          <li key={project.id} className={styles.entity}>
            <TypeMedallion kind="project" size={36} />
            <span className={styles.entityText}>
              <span>{project.name}</span>
              <Caption>{t('New project')}</Caption>
            </span>
            {mergeInto ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  settle(project.id);
                  void mergeProject(project.id, mergeInto.id, capture.id);
                }}
              >
                
                {t('This is {name}', { name: mergeInto.name })}
              </Button>
            ) : null}
            <IconButton
              icon="close"
              label={t('Remove: {name}', { name: project.name })}
              onClick={() => {
                settle(project.id);
                void rejectProject(project.id, capture.id);
              }}
            />
          </li>
        ))}
        {ambiguous.map((mention) => (
          <li key={`${mention.kind}:${mention.name}`} className={styles.entityAsk}>
            <span>
              
              {t('“{name}”: who is it?', { name: mention.name })}
            
            </span>
            <span className={styles.chips}>
              {mention.candidates.map((candidate) => (
                <Chip
                  key={candidate.id}
                  onClick={() => {
                    settle(`${mention.kind}:${mention.name}`);
                    if (mention.kind === 'person') void linkPerson(capture.id, candidate.id);
                  }}
                >
                  {candidate.name}
                </Chip>
              ))}
              {mention.kind === 'person' ? (
                <Chip
                  onClick={() => {
                    settle(`${mention.kind}:${mention.name}`);
                    void createAndLinkPerson(capture.id, mention.name);
                  }}
                >
                  {t('Another')}
                </Chip>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
