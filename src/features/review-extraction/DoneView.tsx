import { useNavigate } from 'react-router-dom';
import { objectsCount } from '../../domain/counts';
import { t } from '../../i18n';
import type { Capture, ID, Item, Person } from '../../domain/types';
import type { Job } from '../../state';
import { Orb } from '../../ui/orb';
import { Body, Button, Caption, Display, Pill, TypeDot } from '../../ui/primitives';
import { EntitiesPanel } from './EntitiesPanel';
import { memoryPhrase } from './model';
import styles from './Review.module.css';

const MAX_CHIPS = 6;

export interface DoneViewProps {
  capture: Capture;
  accepted: readonly Item[];
  dismissed: number;
  people: ReadonlyMap<ID, Person>;
  result: Job['result'];
}

/** «ЗАПИСАНО» (§2.11): what went into memory, with a chip each (§3.5 point 4), and the next step. */
export function DoneView({ capture, accepted, dismissed, people, result }: DoneViewProps) {
  const navigate = useNavigate();
  const auto = result?.autoAccepted ?? 0;
  const shown = accepted.slice(0, MAX_CHIPS);
  const rest = accepted.length - shown.length;

  return (
    <section className={styles.center} aria-labelledby="done-title" data-testid="review-done">
      <div className={styles.orb}>
        <Orb size={140} state="done" />
      </div>
      <Pill tone="ok" dot live className={styles.pill}>
        {t('Recorded')}
      </Pill>
      <Display as="h2" size="xl" id="done-title" className={styles.title}>
        {capture.title ?? t('Recorded')}
      </Display>
      <Body tone="muted" className={styles.note}>
        {accepted.length === 0 && dismissed === 0
          ? t('I found no objects in this record. It is saved in the stream.')
          : `${accepted.length > 0 ? t('Added to memory: {count}', { count: accepted.length }) : t('Nothing added')}${dismissed > 0 ? t(', dismissed: {dismissed}', { dismissed }) : ''}.${auto > 0 ? t(' Accepted automatically: {auto}.', { auto }) : ''}`}
      </Body>

      {shown.length > 0 ? (
        <div className={styles.memory}>
          <Caption>{t('Added to memory')}</Caption>
          <ul className={styles.memoryList}>
            {shown.map((item) => (
              <li key={item.id}>
                <TypeDot kind={item.kind} />
                <span>{memoryPhrase(item, people, 96)}</span>
              </li>
            ))}
            {rest > 0 ? (
              <li>
                <span aria-hidden="true" />
                <span>{t('and {objects} more', { objects: objectsCount(rest) })}</span>
              </li>
            ) : null}
          </ul>
          <Button size="sm" variant="ghost" onClick={() => navigate('/me')}>
            {t('Me → Memory')}
          </Button>
        </div>
      ) : null}

      <EntitiesPanel capture={capture} result={result} />

      <div className={styles.actions}>
        <Button variant="primary" onClick={() => navigate(`/entry/${capture.id}`)}>
          {t('Open the record')}
        </Button>
        <Button variant="secondary" onClick={() => navigate('/today')}>
          {t('To “Today”')}
        </Button>
      </div>
    </section>
  );
}
