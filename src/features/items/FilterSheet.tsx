import type { ID, Person, Project } from '../../domain/types';
import { Button, Chip, Label, Sheet } from '../../ui';
import type { ItemQuery } from './model';
import styles from './FilterSheet.module.css';
import { t } from '../../i18n';

export interface FilterSheetProps {
  open: boolean;
  onClose(): void;
  query: ItemQuery;
  onChange(next: ItemQuery): void;
  /** Only those who appear in the list. */
  people: readonly Person[];
  projects: readonly Project[];
}

/** «Человек» and «проект» filters; applied at once, «Готово» closes. */
export function FilterSheet({ open, onClose, query, onChange, people, projects }: FilterSheetProps) {
  const active = (query.personId ? 1 : 0) + (query.projectId ? 1 : 0);
  const pickPerson = (id: ID): void => onChange({ ...query, personId: query.personId === id ? undefined : id });
  const pickProject = (id: ID): void => onChange({ ...query, projectId: query.projectId === id ? undefined : id });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('Filters')}
      placement="sheet"
      snaps={[0.6, 0.92]}
      defaultSnapIndex={0}
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" size="md" disabled={active === 0} onClick={() => onChange({ ...query, personId: undefined, projectId: undefined })}>
            {t('Reset')}
          </Button>
          <Button variant="primary" size="md" onClick={onClose}>
            {t('Done')}
          </Button>
        </div>
      }
    >
      <div className={styles.body}>
        <section className={styles.group} aria-labelledby="items-filter-people">
          <Label id="items-filter-people">{t('Person')}</Label>
          {people.length === 0 ? (
            <p className={styles.none}>{t('Nobody is mentioned in this list.')}</p>
          ) : (
            <div className={styles.chips}>
              {people.map((person) => (
                <Chip key={person.id} type="person" selected={query.personId === person.id} onClick={() => pickPerson(person.id)}>
                  {person.name}
                </Chip>
              ))}
            </div>
          )}
        </section>
        <section className={styles.group} aria-labelledby="items-filter-projects">
          <Label id="items-filter-projects">{t('Project')}</Label>
          {projects.length === 0 ? (
            <p className={styles.none}>{t('There are no projects in this list.')}</p>
          ) : (
            <div className={styles.chips}>
              {projects.map((project) => (
                <Chip key={project.id} type="project" selected={query.projectId === project.id} onClick={() => pickProject(project.id)}>
                  {project.name}
                </Chip>
              ))}
            </div>
          )}
        </section>
      </div>
    </Sheet>
  );
}
