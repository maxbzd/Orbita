import { Link } from 'react-router-dom';
import type { ID } from '../../domain/types';
import { formatDayShort } from '../../domain/dates';
import { splitByRanges } from '../../search';
import type { SearchHit, TextRange } from '../../search';
import { Icon, TYPE_LABELS, TypeDot } from '../../ui';
import type { ItemsByCapture } from './filters';
import styles from './SearchResults.module.css';
import { t } from '../../i18n';

/** Text with the matched words in <mark> (the browser's own semantics: screen readers say "выделено"). */
export function Highlighted({ text, ranges }: { text: string; ranges: readonly TextRange[] }) {
  if (ranges.length === 0) return <>{text}</>;
  return (
    <>
      {splitByRanges(text, ranges).map((segment, index) =>
        segment.match ? (
          <mark key={index} className={styles.mark}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export interface HitTarget {
  to: string;
  label: string;
}

/** Where a hit leads: a record, the record an object came from (scrolled to its quote), or a person. */
export function hitTarget(hit: SearchHit, captureOfItem: ReadonlyMap<ID, ID>): HitTarget | undefined {
  switch (hit.kind) {
    case 'capture':
      return { to: `/entry/${hit.id}`, label: t('Record') };
    case 'item': {
      const captureId = captureOfItem.get(hit.id);
      return captureId ? { to: `/entry/${captureId}?item=${hit.id}`, label: t('From the record') } : undefined;
    }
    case 'person':
      return { to: `/people/${hit.id}`, label: t('Person') };
    case 'project':
      return undefined;
  }
}

/** item id → capture id, from the objects the stream already holds. */
export function captureOfItems(itemsByCapture: ItemsByCapture): Map<ID, ID> {
  const map = new Map<ID, ID>();
  for (const [captureId, items] of itemsByCapture) for (const item of items) map.set(item.id, captureId);
  return map;
}

export interface SearchResultsProps {
  hits: readonly SearchHit[];
  captureOfItem: ReadonlyMap<ID, ID>;
}

function kindLabel(hit: SearchHit): string {
  if (hit.kind === 'item' && hit.itemKind) return TYPE_LABELS[hit.itemKind];
  if (hit.kind === 'person') return t('Person');
  if (hit.kind === 'project') return t('Project');
  return hit.captureKind === 'voice' ? t('Voice recording') : t('Record');
}

export function SearchResults({ hits, captureOfItem }: SearchResultsProps) {
  return (
    <ul className={styles.list} aria-label={t('Search results')}>
      {hits.map((hit) => {
        const target = hitTarget(hit, captureOfItem);
        const body = (
          <>
            <span className={styles.top}>
              {hit.kind === 'item' && hit.itemKind ? <TypeDot kind={hit.itemKind} /> : hit.kind === 'person' ? <TypeDot kind="person" /> : <Icon name="stream" size={16} />}
              <span className={styles.kind}>{kindLabel(hit)}</span>
              {hit.day ? <span className={styles.day}>{formatDayShort(hit.day)}</span> : null}
            </span>
            <span className={styles.title}>
              <Highlighted text={hit.title} ranges={hit.titleRanges} />
            </span>
            {hit.snippet ? (
              <span className={styles.snippet}>
                <Highlighted text={hit.snippet.text} ranges={hit.snippet.ranges} />
              </span>
            ) : null}
          </>
        );
        return (
          <li key={hit.key} className={styles.item}>
            {target ? (
              <Link to={target.to} className={styles.link}>
                {body}
              </Link>
            ) : (
              <div className={styles.link}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
