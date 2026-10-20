import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { formatDayShort, formatDayWithWeekday, localDayKey } from '../../domain/dates';
import type { DayKey, ID, Item, Person, Project } from '../../domain/types';
import { Body, Caption, Chip, Icon, Label, ProgressRing, cx } from '../../ui';
import type { RelatedEntity } from './hooks';
import { ITEM_STATUS_LABELS, RATING_LABELS, STAGE_LABELS, dueInfo, reviewWindow } from './model';
import styles from './ItemDetails.module.css';
import { tx } from '../../i18n/react';
import { t } from '../../i18n';

const PRIORITY_NAMES = { get low() { return t('Low', undefined, 'priority') }, get normal() { return t('Normal') }, get high() { return t('High', undefined, 'priority') } } as const;
const OUTCOME_NAMES = { get true() { return t('Came true') }, get false() { return t('Did not come true') }, get unknown() { return t('Outcome unknown') } } as const;

interface Row {
  label: string;
  value: ReactNode;
}

const list = (lines: readonly string[]): ReactNode =>
  lines.length === 0 ? null : (
    <ul className={styles.bullets}>
      {lines.map((line, index) => (
        <li key={`${index}-${line}`}>{line}</li>
      ))}
    </ul>
  );

function dueValue(item: Item, today: DayKey, openOnly = true): ReactNode {
  if (!item.dueAt) return null;
  const info = dueInfo(item, today);
  const day = localDayKey(item.dueAt);
  const words = openOnly && item.status !== 'active' ? null : info?.label;
  return (
    <span className={cx(info?.overdue && openOnly && item.status === 'active' && styles.late)}>
      {formatDayWithWeekday(day)}
      {words ? ` · ${words}` : ''}
    </span>
  );
}

function kindRows(item: Item, today: DayKey, now: string, people: ReadonlyMap<ID, Person>): Row[] {
  const rows: Row[] = [];
  const add = (label: string, value: ReactNode): void => {
    if (value !== null && value !== undefined && value !== '' && value !== false) rows.push({ label, value });
  };
  switch (item.kind) {
    case 'commitment': {
      const person = item.counterpartyId ? people.get(item.counterpartyId) : undefined;
      add(t('Direction'), item.direction === 'i_owe' ? t('I owe') : t('Owed to me'));
      add(
        item.direction === 'i_owe' ? t('Owed to') : t('Owed by'),
        person ? <Link to={`/people/${person.id}`}>{person.name}</Link> : item.counterpartyName,
      );
      add(t('Due'), dueValue(item, today));
      break;
    }
    case 'decision': {
      const window = reviewWindow(item, now, today);
      add(t('Question'), item.question);
      add(t('Chosen'), item.chosen !== item.title ? item.chosen : null);
      add(t('Alternatives'), list(item.alternatives));
      add(t('Reasons'), list(item.reasons));
      add(t('Expected'), item.expected);
      if (item.dueAt) {
        add(
          t('Review', undefined, 'item-details'),
          <span className={styles.ringLine}>
            {window ? (
              <ProgressRing value={window.progress} size={32} stroke={3} label={t('Review window')} valueText={window.label} color={window.due ? 'var(--warn)' : 'var(--t-decision)'} />
            ) : null}
            <span>
              {formatDayWithWeekday(localDayKey(item.dueAt))}
              {window ? ` · ${window.label}` : ''}
            </span>
          </span>,
        );
      }
      if (item.outcome) {
        add(
          t('Result'),
          <span>
            {tx('{rating} of 5 · {v} {v2}', { rating: item.outcome.rating, v: RATING_LABELS[item.outcome.rating], v2: item.outcome.note ? <Caption as="span" className={styles.sub}>{item.outcome.note}</Caption> : null })}
          </span>,
        );
      }
      break;
    }
    case 'prediction':
      add(t('Probability'), `${Math.round(item.probability * 100)} %`);
      add(t('Becomes known'), dueValue(item, today, !item.outcome));
      if (item.outcome) {
        add(
          t('Outcome'),
          <span>
            {OUTCOME_NAMES[item.outcome]}
            {item.resolvedAt ? ` · ${formatDayShort(localDayKey(item.resolvedAt))}` : ''}
            {item.resolutionNote ? <Caption as="span" className={styles.sub}>{item.resolutionNote}</Caption> : null}
          </span>,
        );
      }
      break;
    case 'idea':
      add(t('Stage'), STAGE_LABELS[item.stage]);
      break;
    case 'task':
      add(t('Due'), dueValue(item, today));
      add(t('Priority'), item.priority ? PRIORITY_NAMES[item.priority] : null);
      add(t('For the day'), item.scheduledFor ? formatDayWithWeekday(item.scheduledFor) : null);
      break;
    case 'question':
      add(t('Answer'), item.answer?.trim());
      break;
    case 'fact':
      add(t('Value'), item.value);
      add(t('In effect since'), item.validFrom ? formatDayShort(localDayKey(item.validFrom), { withYear: true }) : null);
      break;
    case 'lesson':
      break;
  }
  return rows;
}

export interface ItemDetailsProps {
  item: Item;
  today: DayKey;
  now: string;
  people: readonly Person[];
  projects: readonly Project[];
  related: readonly RelatedEntity[];
  onOpenRelated(entity: RelatedEntity): void;
}

/** The fields of an object for reading: the kind's own, the quote with "Откуда это", people, projects and links. */
export function ItemDetails({ item, today, now, people, projects, related, onOpenRelated }: ItemDetailsProps) {
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const rows = kindRows(item, today, now, peopleById);
  const linkedPeople = item.personIds.flatMap((id) => peopleById.get(id) ?? []);
  const linkedProjects = projects.filter((project) => item.projectIds.includes(project.id));

  return (
    <div className={styles.details}>
      {item.body ? <Body className={styles.body}>{item.body}</Body> : null}

      {rows.length > 0 ? (
        <dl className={styles.rows}>
          {rows.map((row) => (
            <div key={row.label} className={styles.row}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <section className={styles.source} aria-label={t('Where this comes from')}>
        {item.quote ? <blockquote className={styles.quote}>«{item.quote}»</blockquote> : null}
        {item.captureId ? (
          <Link className={styles.sourceLink} to={`/entry/${item.captureId}?item=${item.id}`}>
            <Icon name="link" size={18} />
            {t('Where this comes from')}
          </Link>
        ) : item.sourceDeleted ? (
          <Caption>{t('Source deleted.')}</Caption>
        ) : (
          <Caption>{t('Created by hand, no source.')}</Caption>
        )}
      </section>

      {linkedPeople.length > 0 || linkedProjects.length > 0 ? (
        <section className={styles.group} aria-label={t('People and projects')}>
          <Label>{t('People and projects')}</Label>
          <div className={styles.chips}>
            {linkedPeople.map((person) => (
              <Link key={person.id} to={`/people/${person.id}`} className={styles.chipLink}>
                <Chip type="person">{person.name}</Chip>
              </Link>
            ))}
            {linkedProjects.map((project) => (
              <Chip key={project.id} type="project">
                {project.name}
              </Chip>
            ))}
          </div>
        </section>
      ) : null}

      {related.length > 0 ? (
        <section className={styles.group} aria-label={t('Links')}>
          <Label>{t('Links')}</Label>
          <ul className={styles.related}>
            {related.map((entity) => (
              <li key={`${entity.relation}-${entity.id}`}>
                <button type="button" className={styles.relatedButton} onClick={() => onOpenRelated(entity)}>
                  <span className={styles.relation}>{entity.relation}</span>
                  <span className={styles.relatedTitle}>{entity.title}</span>
                  <Icon name="chevron-right" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Caption className={styles.status}>
        {t('{v} · created {formatDayShort}', { v: ITEM_STATUS_LABELS[item.status], formatDayShort: formatDayShort(localDayKey(item.createdAt), { withYear: true }) })}
      </Caption>
    </div>
  );
}
