import type { ID, Person, Project } from '../../domain/types';
import { Button, Chip, Label, Sheet } from '../../ui';
import { PERIOD_OPTIONS, countSheetFilters } from './filters';
import type { PeriodFilter, StreamFilters } from './filters';
import styles from './FilterSheet.module.css';
import { t } from '../../i18n';

export interface FilterSheetProps {
  open: boolean;
  onClose(): void;
  filters: StreamFilters;
  onChange(next: StreamFilters): void;
  people: readonly Person[];
  projects: readonly Project[];
}

const MAX_PEOPLE = 24;

/** The filters that do not fit the chip row: who, which project, how far back. Applied at once, "Готово" closes. */
export function FilterSheet({ open, onClose, filters, onChange, people, projects }: FilterSheetProps) {
  const active = countSheetFilters(filters);
  const shownPeople = people.filter((person) => !person.archived).sort((a, b) => b.mentionCount - a.mentionCount).slice(0, MAX_PEOPLE);
  const pickPerson = (id: ID): void => onChange({ ...filters, personId: filters.personId === id ? undefined : id });
  const pickProject = (id: ID): void => onChange({ ...filters, projectId: filters.projectId === id ? undefined : id });
  const pickPeriod = (period: PeriodFilter): void => onChange({ ...filters, period });

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
          <Button variant="ghost" size="md" disabled={active === 0} onClick={() => onChange({ ...filters, personId: undefined, projectId: undefined, period: 'all' })}>
            {t('Reset')}
          </Button>
          <Button variant="primary" size="md" onClick={onClose}>
            {t('Done')}
          </Button>
        </div>
      }
    >
      <div className={styles.body}>
        <section className={styles.group} aria-labelledby="stream-filter-period">
          <Label id="stream-filter-period">{t('Period')}</Label>
          <div className={styles.chips}>
            {PERIOD_OPTIONS.map((option) => (
              <Chip key={option.value} selected={filters.period === option.value} onClick={() => pickPeriod(option.value)}>
                {option.label}
              </Chip>
            ))}
          </div>
        </section>

        <section className={styles.group} aria-labelledby="stream-filter-people">
          <Label id="stream-filter-people">{t('Person')}</Label>
          {shownPeople.length > 0 ? (
            <div className={styles.chips}>
              {shownPeople.map((person) => (
                <Chip key={person.id} selected={filters.personId === person.id} onClick={() => pickPerson(person.id)}>
                  {person.name}
                </Chip>
              ))}
            </div>
          ) : (
            <p className={styles.hint}>{t('People will appear once you name someone in a record.')}</p>
          )}
        </section>

        <section className={styles.group} aria-labelledby="stream-filter-projects">
          <Label id="stream-filter-projects">{t('Project')}</Label>
          {projects.length > 0 ? (
            <div className={styles.chips}>
              {projects.map((project) => (
                <Chip key={project.id} selected={filters.projectId === project.id} onClick={() => pickProject(project.id)}>
                  {project.name}
                </Chip>
              ))}
            </div>
          ) : (
            <p className={styles.hint}>{t('No projects yet.')}</p>
          )}
        </section>
      </div>
    </Sheet>
  );
}
