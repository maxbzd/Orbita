import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useItems } from '../../db/hooks';
import type { Item, ItemKind } from '../../domain/types';
import { Body, CollectionCard, Display, IconButton, Skeleton } from '../../ui';
import { CreateSheet } from './CreateSheet';
import { KIND_ORDER, statusMatches } from './model';
import styles from './CollectionsScreen.module.css';
import { t } from '../../i18n';

interface Collection {
  count: number;
  previews: string[];
}

const PREVIEW_LINES = 3;

/** Counts and the latest titles of every kind. Closed objects count, but the preview prefers the open ones. */
function collect(items: readonly Item[]): Record<ItemKind, Collection> {
  const result = Object.fromEntries(KIND_ORDER.map((kind) => [kind, { count: 0, previews: [] as string[] }])) as Record<ItemKind, Collection>;
  const newest = [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const item of newest) {
    if (!statusMatches(item.status, 'all')) continue;
    result[item.kind].count += 1;
  }
  for (const kind of KIND_ORDER) {
    const own = newest.filter((item) => item.kind === kind && statusMatches(item.status, 'all'));
    const open = own.filter((item) => item.status === 'active');
    const closed = own.filter((item) => item.status !== 'active');
    result[kind].previews = [...open, ...closed].slice(0, PREVIEW_LINES).map((item) => item.title);
  }
  return result;
}

/** «Коллекции» (SPEC §4.8): eight cards, one per kind of object. */
export default function CollectionsScreen() {
  const navigate = useNavigate();
  const items = useItems();
  const [creating, setCreating] = useState(false);
  const collections = useMemo(() => (items ? collect(items) : undefined), [items]);
  const empty = collections !== undefined && KIND_ORDER.every((kind) => collections[kind].count === 0);

  return (
    <section className={styles.screen} aria-labelledby="collections-title">
      <header className={styles.header}>
        <IconButton icon="chevron-left" label={t('Back')} onClick={() => navigate(-1)} />
        <Display as="h1" size="l" id="collections-title" className={styles.title}>
          {t('Collections')}
        </Display>
        <IconButton icon="plus" label={t('Add an object')} variant="glass" onClick={() => setCreating(true)} />
      </header>

      {empty ? <Body tone="muted">{t('Nothing here yet. Objects appear after your records are processed, and you can add one with the “+” button.')}</Body> : null}

      {collections === undefined ? (
        <div className={styles.grid} aria-busy="true">
          {KIND_ORDER.map((kind) => (
            <Skeleton key={kind} shape="block" height={172} />
          ))}
        </div>
      ) : (
        <ul className={styles.grid}>
          {KIND_ORDER.map((kind) => (
            <li key={kind} className={styles.cell}>
              <CollectionCard kind={kind} count={collections[kind].count} previews={collections[kind].previews} onOpen={() => navigate(`/items/${kind}`)} />
            </li>
          ))}
        </ul>
      )}

      <CreateSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          navigate(`/items/${created.kind}?item=${created.id}`);
        }}
      />
    </section>
  );
}
