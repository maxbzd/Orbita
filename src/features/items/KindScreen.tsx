import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { itemsRepo } from '../../db';
import { useItems, usePeople, useProjects } from '../../db/hooks';
import { nowISO } from '../../domain/dates';
import type { ID, Item, ItemKind } from '../../domain/types';
import type { SegmentOption } from '../../ui';
import { Button, Chip, Display, EmptyState, Icon, IconButton, Label, Search, SegmentedControl, Skeleton, TYPE_LABELS_PLURAL, useToast } from '../../ui';
import { CalibrationPanel } from './CalibrationPanel';
import { CreateSheet } from './CreateSheet';
import { FilterSheet } from './FilterSheet';
import { ItemRow } from './ItemRow';
import { ItemSheet } from './ItemSheet';
import { useToday } from './hooks';
import {
  EMPTY_QUERY,
  STATUS_FILTERS,
  STATUS_FILTER_LABELS,
  countByStatusFilter,
  filterDirection,
  filterItems,
  groupCommitmentsByPerson,
  groupItems,
  isItemKind,
  itemPeople,
} from './model';
import type { DirectionFilter, ItemQuery } from './model';
import { EMPTY_TEXT } from './texts';
import styles from './KindScreen.module.css';
import { t } from '../../i18n';

const DIRECTIONS: ReadonlyArray<SegmentOption<DirectionFilter>> = [
  { value: 'all', get label() { return t('All') } },
  { value: 'i_owe', get label() { return t('I owe') } },
  { value: 'owed_to_me', get label() { return t('Owed to me') } },
];

const VIEWS: ReadonlyArray<SegmentOption<'time' | 'people'>> = [
  { value: 'time', get label() { return t('By due date') } },
  { value: 'people', get label() { return t('By person') } },
];

/** «Коллекции» → one kind: a list with the shared interface (search, status, people, projects, groups) and the kind's own parts. */
export default function KindScreen() {
  const { kind } = useParams();
  if (!isItemKind(kind)) {
    return (
      <section className={styles.screen}>
        <EmptyState
          title={t('No such kind of object.')}
          action={
            <Link to="/items">
              <Button variant="secondary" size="sm" iconStart="chevron-left" tabIndex={-1}>
                {t('To collections')}
              </Button>
            </Link>
          }
        />
      </section>
    );
  }
  return <KindList key={kind} kind={kind} />;
}

function KindList({ kind }: { kind: ItemKind }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const openId = params.get('item') ?? undefined;

  const items = useItems({ kind });
  const people = usePeople({ includeArchived: true });
  const projects = useProjects();
  const today = useToday();
  const now = useMemo(() => nowISO(), [today, items]);

  const [query, setQuery] = useState<ItemQuery>(EMPTY_QUERY);
  const [direction, setDirection] = useState<DirectionFilter>('all');
  const [view, setView] = useState<'time' | 'people'>('time');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const peopleById = useMemo(() => new Map((people ?? []).map((person) => [person.id, person])), [people]);

  const scoped = useMemo(() => (items ? (kind === 'commitment' ? filterDirection(items, direction) : items) : undefined), [items, kind, direction]);
  const visible = useMemo(() => (scoped ? filterItems(scoped, query) : undefined), [scoped, query]);
  const counts = useMemo(() => (scoped ? countByStatusFilter(scoped) : undefined), [scoped]);

  const groups = useMemo(() => {
    if (!visible) return undefined;
    if (kind === 'commitment' && view === 'people' && query.status !== 'proposed') return groupCommitmentsByPerson(visible, peopleById, { today });
    return groupItems(kind, visible, { today });
  }, [visible, kind, view, query.status, peopleById, today]);

  // Who and what appears in this list: the filter sheet offers only those.
  const listedPeople = useMemo(() => {
    const ids = new Set<ID>((items ?? []).flatMap((item) => itemPeople(item)));
    return (people ?? []).filter((person) => ids.has(person.id));
  }, [items, people]);
  const listedProjects = useMemo(() => {
    const ids = new Set<ID>((items ?? []).flatMap((item) => item.projectIds));
    return (projects ?? []).filter((project) => ids.has(project.id));
  }, [items, projects]);
  const activeFilters = (query.personId ? 1 : 0) + (query.projectId ? 1 : 0);

  const setOpenId = (id: ID | undefined, replace = true): void => {
    const next = new URLSearchParams(params);
    if (id) next.set('item', id);
    else next.delete('item');
    setParams(next, { replace });
  };

  const toggleDone = async (item: Item): Promise<void> => {
    if (item.status === 'done') {
      await itemsRepo.reopen(item.id);
      return;
    }
    await itemsRepo.setStatus(item.id, 'done');
    toast.show({ message: t('Done.'), actionLabel: t('Restore'), onAction: () => void itemsRepo.reopen(item.id) });
  };

  const total = items?.length ?? 0;
  const loading = items === undefined || groups === undefined || visible === undefined;
  const filtering = query.text.trim() !== '' || query.status !== 'all' || activeFilters > 0 || direction !== 'all';
  const reset = (): void => {
    setQuery(EMPTY_QUERY);
    setDirection('all');
  };

  return (
    <section className={styles.screen} aria-labelledby="kind-title">
      <header className={styles.header}>
        <IconButton icon="chevron-left" label={t('Collections')} onClick={() => navigate('/items')} />
        <Display as="h1" size="l" id="kind-title" className={styles.title}>
          {TYPE_LABELS_PLURAL[kind]}
        </Display>
        <IconButton icon="plus" label={t('Add: {v}', { v: TYPE_LABELS_PLURAL[kind] })} variant="glass" onClick={() => setCreating(true)} />
      </header>

      {total > 0 ? (
        <>
          <Search aria-label={t('Search objects')} placeholder={t('Search')} value={query.text} onChange={(text) => setQuery({ ...query, text })} />

          {kind === 'commitment' ? (
            <div className={styles.toggles}>
              <SegmentedControl<DirectionFilter> aria-label={t('Whose commitment')} fullWidth value={direction} onChange={setDirection} options={DIRECTIONS} />
              <SegmentedControl<'time' | 'people'> aria-label={t('Grouping')} size="sm" value={view} onChange={setView} options={VIEWS} />
            </div>
          ) : null}

          <div className={styles.chipRow} role="group" aria-label={t('Status')}>
            {STATUS_FILTERS.filter((status) => status !== 'proposed' || (counts?.proposed ?? 0) > 0).map((status) => (
              <Chip key={status} selected={query.status === status} count={counts?.[status]} onClick={() => setQuery({ ...query, status })}>
                {STATUS_FILTER_LABELS[status]}
              </Chip>
            ))}
            <span className={styles.chipDivider} aria-hidden="true" />
            <Chip selected={activeFilters > 0} count={activeFilters || undefined} leading={<Icon name="person" size={16} />} onClick={() => setFiltersOpen(true)}>
              {t('People and projects')}
            </Chip>
          </div>

          {kind === 'prediction' ? <CalibrationPanel predictions={items ?? []} /> : null}
        </>
      ) : null}

      {loading ? (
        <div className={styles.skeletons} aria-busy="true">
          <Skeleton shape="block" height={64} label={t('Loading')} />
          <Skeleton shape="block" height={64} />
          <Skeleton shape="block" height={64} />
        </div>
      ) : total === 0 ? (
        <EmptyState
          title={EMPTY_TEXT[kind].title}
          description={EMPTY_TEXT[kind].description}
          action={
            <Button variant="primary" size="md" iconStart="plus" onClick={() => setCreating(true)}>
              {t('Add')}
            </Button>
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState
          compact
          illustration="none"
          title={filtering ? t('Nothing found.') : EMPTY_TEXT[kind].title}
          action={
            filtering ? (
              <Button variant="secondary" size="sm" onClick={reset}>
                {t('Reset filters')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={styles.groups}>
          {groups.map((group) => {
            const headingId = `group-${group.id}`;
            return (
              <section key={group.id} className={styles.group} aria-labelledby={group.title ? headingId : undefined} data-group={group.id}>
                {group.title ? (
                  <h2 id={headingId} className={styles.groupTitle}>
                    <Label as="span" tone="strong">
                      {group.title}
                    </Label>
                    <span className={styles.groupCount}>{group.items.length}</span>
                  </h2>
                ) : null}
                <ul className={styles.list}>
                  {group.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      today={today}
                      now={now}
                      people={peopleById}
                      onOpen={(opened) => setOpenId(opened.id, false)}
                      onToggleDone={(toggled) => void toggleDone(toggled)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <FilterSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} query={query} onChange={setQuery} people={listedPeople} projects={listedProjects} />
      <CreateSheet
        open={creating}
        kind={kind}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          setOpenId(created.id);
        }}
      />
      <ItemSheet
        itemId={openId}
        onClose={() => setOpenId(undefined)}
        onOpenItem={(id, otherKind) => {
          if (otherKind && otherKind !== kind) navigate(`/items/${otherKind}?item=${id}`);
          else setOpenId(id);
        }}
        onOpenEntity={(entity) => {
          if (entity.table === 'captures') navigate(`/entry/${entity.id}`);
          else if (entity.table === 'people') navigate(`/people/${entity.id}`);
          else if (entity.table === 'patterns') navigate('/patterns');
          else if (entity.table === 'reviews') navigate(`/reviews/${entity.id}`);
        }}
      />
    </section>
  );
}
