import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatClock } from '../../domain/dates';
import type { Capture, Item } from '../../domain/types';
import { Caption, Thought } from '../../ui/primitives';
import { approximateSecond } from './model';
import styles from './Review.module.css';
import { t } from '../../i18n';

/**
 * «Откуда это» (§3.5 point 5, SPEC §2.4): the verbatim sentence the object was made from, with a rough place in the
 * recording and a way to the record. The text has offsets, not time stamps, so the time is marked as approximate.
 */
export function SourceQuote({ item, capture }: { item: Item; capture: Capture }) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const second = approximateSecond(capture, item.quoteStart);

  return (
    <div className={styles.source}>
      <button type="button" className={styles.sourceToggle} aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((value) => !value)}>
        {t('Where this comes from')}
      </button>
      {open ? (
        <div id={regionId} className={styles.sourceBody}>
          {item.quote ? (
            <blockquote className={styles.quote}>
              <Thought size="sm" italic>
                «{item.quote}»
              </Thought>
            </blockquote>
          ) : (
            <Caption>{t('There is no verbatim quote: the AI inferred this from the record as a whole.')}</Caption>
          )}
          <Caption>
            {capture.title ?? t('Record')}
            {second !== undefined ? t(' · around {formatClock}', { formatClock: formatClock(second) }) : ''}
            {' · '}
            <Link to={`/entry/${capture.id}${second !== undefined ? `?t=${second}` : ''}`} className={styles.link}>
              {t('To the record')}
            </Link>
          </Caption>
        </div>
      ) : null}
    </div>
  );
}
