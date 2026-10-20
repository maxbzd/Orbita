import { useId, useState } from 'react';
import type { CaptureContext, ID, Project } from '../../domain/types';
import { Chip } from '../../ui/primitives';
import { CONTEXT_CHOICES, PROJECT_CHIPS, contextSummary } from './contexts';
import styles from './CaptureScreen.module.css';
import { t } from '../../i18n';

export interface ContextChipsProps {
  context: CaptureContext | null;
  projects: readonly Project[];
  projectIds: readonly ID[];
  onContext(context: CaptureContext | null): void;
  onProjects(ids: ID[]): void;
}

/**
 * One 32 px row: collapsed to a single «Контекст» chip so that nothing competes with the orb; opened it shows where
 * the user is and which project this is about. Choosing is optional and never delays the recording.
 */
export function ContextChips({ context, projects, projectIds, onContext, onProjects }: ContextChipsProps) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const chosen = projects.filter((project) => projectIds.includes(project.id)).map((project) => project.name);

  return (
    <div className={styles.context}>
      <Chip
        selected={open}
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
      >
        {contextSummary(context, chosen)}
      </Chip>
      {open ? (
        <div id={regionId} className={styles.contextRow} role="group" aria-label={t('Recording context')}>
          {CONTEXT_CHOICES.map((choice) => (
            <Chip key={choice.value} selected={context === choice.value} onClick={() => onContext(context === choice.value ? null : choice.value)}>
              {choice.label}
            </Chip>
          ))}
          {projects.slice(0, PROJECT_CHIPS).map((project) => {
            const selected = projectIds.includes(project.id);
            return (
              <Chip
                key={project.id}
                type="project"
                selected={selected}
                onClick={() => onProjects(selected ? projectIds.filter((id) => id !== project.id) : [...projectIds, project.id])}
              >
                {project.name}
              </Chip>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
