import type { DayKey, ID, Item, Person } from '../../domain/types';
import { Icon, IconButton, ProgressRing, TYPE_LABELS, TypeMedallion, cx } from '../../ui';
import { dueText, isOverdue, reviewWindow, rowSubtitle } from './model';
import styles from './ItemRow.module.css';
import { t } from '../../i18n';

export interface ItemRowProps {
  item: Item;
  today: DayKey;
  now: string;
  people: ReadonlyMap<ID, Pick<Person, 'name'>>;
  onOpen(item: Item): void;
  /** Quick "готово" / "вернуть" on the row (commitments, tasks, questions…). */
  onToggleDone?(item: Item): void;
}

const QUICK_KINDS: ReadonlySet<Item['kind']> = new Set(['commitment', 'task']);

/** One object in a list: medallion, wording, the kind's quiet line, the deadline in words, a quick action. */
export function ItemRow({ item, today, now, people, onOpen, onToggleDone }: ItemRowProps) {
  const subtitle = rowSubtitle(item, people);
  const due = dueText(item, today);
  const late = isOverdue(item, today);
  const closed = item.status === 'done' || item.status === 'dropped';
  const ring = item.kind === 'decision' ? reviewWindow(item, now, today) : undefined;
  const quick = onToggleDone && QUICK_KINDS.has(item.kind) && (item.status === 'active' || item.status === 'done');

  return (
    <li className={cx(styles.row, closed && styles.closed)} data-item={item.id} data-status={item.status}>
      <button type="button" className={styles.main} onClick={() => onOpen(item)} aria-label={`${TYPE_LABELS[item.kind]}: ${item.title}`}>
        <TypeMedallion kind={item.kind} size={36} />
        <span className={styles.text}>
          <span className={cx(styles.title, closed && styles.struck)}>{item.title}</span>
          {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
          {due ? (
            <span className={cx(styles.due, late && styles.late)}>
              {late ? <Icon name="alert" size={14} /> : null}
              {due}
            </span>
          ) : null}
        </span>
        <Icon name="chevron-right" size={20} className={styles.chevron} />
      </button>
      {ring ? (
        <div className={styles.side}>
          <ProgressRing value={ring.progress} size={36} stroke={3} label={t('Review window')} valueText={ring.label} color={ring.due ? 'var(--warn)' : 'var(--t-decision)'}>
            <span className={styles.ringText}>{ring.due ? '!' : Math.max(0, ring.daysLeft)}</span>
          </ProgressRing>
        </div>
      ) : null}
      {quick ? (
        <div className={styles.side}>
          <IconButton
            icon="check"
            variant="ghost"
            label={item.status === 'done' ? t('Reopen: {title}', { title: item.title }) : t('Done: {title}', { title: item.title })}
            pressed={item.status === 'done'}
            onClick={() => onToggleDone(item)}
          />
        </div>
      ) : null}
    </li>
  );
}
