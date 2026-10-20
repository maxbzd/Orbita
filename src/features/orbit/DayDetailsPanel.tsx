import { formatDayWithWeekday, formatTime, localDayKey } from '../../domain/dates';
import { itemKindCount, objectsCount } from '../../domain/counts';
import type { ItemKind } from '../../domain/types';
import { Body, Caption, Label, ListRow, TypeDot, TypeMedallion, cx, moodWord } from '../../ui';
import type { Layers, DayDetails } from './model';
import { captureTitle, dominantKind } from './model';
import styles from './Orbit.module.css';
import { useLinkProps } from './useLink';
import { t } from '../../i18n';

interface DayDetailsPanelProps {
  details: DayDetails;
  layers: Layers;
  today: string;
  /** A segment tapped on the disk: its row is marked. */
  highlightId: string | null;
}

const KIND_SET: ReadonlySet<string> = new Set<ItemKind>(['decision', 'commitment', 'idea', 'prediction', 'task', 'question', 'lesson', 'fact']);

/** What happened on the tapped day: records (links to /entry), states, objects, deadlines, patterns. */
export function DayDetailsPanel({ details, layers, today, highlightId }: DayDetailsPanelProps) {
  const link = useLinkProps();
  const evidence = new Set(details.patterns.flatMap((p) => p.evidence.map((e) => e.captureId)));
  const captures = layers.records ? details.captures : layers.patterns ? details.captures.filter((c) => evidence.has(c.id)) : [];
  const objectCount = [...details.items.values()].reduce((sum, list) => sum + list.length, 0);
  const nothing =
    details.captures.length === 0 && details.checkIns.length === 0 && details.due.length === 0 && details.patterns.length === 0;

  return (
    <section className={styles.details} aria-labelledby="day-title">
      <header className={styles.detailsHead}>
        <Label as="h2" tone="strong" id="day-title">
          {formatDayWithWeekday(details.day)}
        </Label>
        {details.day === today ? <Caption>{t('today')}</Caption> : null}
      </header>

      {nothing ? <Body tone="muted">{details.day > today ? t('This day is still ahead.') : t('No records on this day.')}</Body> : null}

      {captures.length > 0 ? (
        <div className={styles.group}>
          <Caption className={styles.groupTitle}>
            
            {t('Records · {count} {v}', { count: captures.length, v: objectCount > 0 ? t(' · objects: {objectCount}', { objectCount }) : '' })}
          </Caption>
          <ul className={styles.rows} aria-label={t('Records of the day')}>
            {captures.map((capture) => {
              const items = details.items.get(capture.id) ?? [];
              const kind = dominantKind(items);
              const counts = new Map<string, number>();
              for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
              const summary = [...counts.entries()].map(([k, n]) => (KIND_SET.has(k) ? itemKindCount(k as ItemKind, n) : objectsCount(n))).join(', ');
              return (
                <ListRow
                  key={capture.id}
                  as="li"
                  className={cx(highlightId === capture.id && styles.marked)}
                  leading={kind ? <TypeMedallion kind={kind} /> : <TypeMedallion kind={capture.kind === 'checkin' ? 'state' : 'fact'} />}
                  title={captureTitle(capture)}
                  subtitle={summary || undefined}
                  meta={formatTime(capture.createdAt)}
                  {...link(`/entry/${capture.id}`)}
                />
              );
            })}
          </ul>
        </div>
      ) : null}

      {layers.state && details.checkIns.length > 0 ? (
        <div className={styles.group}>
          <Caption className={styles.groupTitle}>{t('State')}</Caption>
          <ul className={styles.rows} aria-label={t('State for the day')}>
            {details.checkIns.map((checkIn) => (
              <ListRow
                key={checkIn.id}
                as="li"
                leading={<TypeMedallion kind="state" />}
                title={moodWord(checkIn.valence * 3)}
                subtitle={[
                  t('energy {round} %', { round: Math.round(checkIn.energy * 100) }),
                  checkIn.stress !== undefined ? t('tension {round} %', { round: Math.round(checkIn.stress * 100) }) : '',
                  checkIn.sleepHours !== undefined ? t('sleep {replace} h', { replace: String(checkIn.sleepHours).replace('.', ',') }) : '',
                  checkIn.origin === 'ai_suggested' ? t('suggested by AI, not confirmed') : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
                meta={formatTime(checkIn.at)}
                {...(checkIn.captureId ? link(`/entry/${checkIn.captureId}`) : {})}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {layers.commitments && details.due.length > 0 ? (
        <div className={styles.group}>
          <Caption className={styles.groupTitle}>{t('Commitment deadlines')}</Caption>
          <ul className={styles.rows} aria-label={t('Commitment deadlines')}>
            {details.due.map((item) => {
              const late = item.status === 'active' && item.dueAt !== undefined && localDayKey(item.dueAt) < today;
              return (
                <ListRow
                  key={item.id}
                  as="li"
                  className={cx(highlightId === `item:${item.id}` && styles.marked)}
                  leading={<TypeMedallion kind="commitment" />}
                  title={item.title}
                  subtitle={item.direction === 'i_owe' ? t('I owe') : t('Owed to me')}
                  meta={item.status === 'done' ? t('closed') : late ? t('overdue') : item.dueAt ? formatTime(item.dueAt) : undefined}
                  tone={late ? 'danger' : 'default'}
                  {...(item.captureId ? link(`/entry/${item.captureId}`) : link('/items/commitment'))}
                />
              );
            })}
          </ul>
        </div>
      ) : null}

      {layers.patterns && details.patterns.length > 0 ? (
        <div className={styles.group}>
          <Caption className={styles.groupTitle}>{t('Patterns visible here')}</Caption>
          <ul className={styles.rows} aria-label={t('Patterns of the day')}>
            {details.patterns.map((pattern) => (
              <ListRow
                key={pattern.id}
                as="li"
                leading={<TypeDot kind="pattern" />}
                title={pattern.title}
                subtitle={pattern.status === 'confirmed' ? t('Confirmed') : t('Candidate: needs your check')}
                {...link('/orbit?tab=patterns')}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
