import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { capturesRepo, peopleRepo } from '../../db';
import { localDayKey } from '../../domain/dates';
import { mentionsCount } from '../../domain/counts';
import { t } from '../../i18n';
import { Body, Button, Caption, Chip, EmptyState, ListRow, PeopleLines, PeopleSphere, ROLE_LABELS, Search, SegmentedControl, Skeleton, cx, initials, nameHue } from '../../ui';
import { useBreakpoint } from '../../styles';
import type { PersonRole } from '../../domain/types';
import { useLinkProps } from '../orbit/useLink';
import { PersonFormSheet } from './PersonFormSheet';
import { coMentionLinks, filterPeople, lastMentionLabel, peopleCountLabel, peopleStats, roleCounts, toLinesPeople, toSpherePerson } from './model';
import styles from './People.module.css';

type Mode = 'sphere' | 'lines';

async function loadPeople() {
  const [people, captures] = await Promise.all([peopleRepo.list({ includeArchived: true }), capturesRepo.list()]);
  return { people, captures: captures.filter((capture) => capture.personIds.length > 0) };
}

/** Avatar with initials, tinted by the name. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span className={styles.avatar} style={{ width: size, height: size, '--hue': nameHue(name) } as React.CSSProperties} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/** «Орбита → Люди» (SPEC §4.9): the sphere (hero) or the lines, the list always below, search and role filter. */
export function PeopleView() {
  const link = useLinkProps();
  const phone = useBreakpoint() === 'phone';
  const data = useLiveQuery(loadPeople, []);
  const [mode, setMode] = useState<Mode>('sphere');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<PersonRole | 'all'>('all');
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const today = localDayKey();

  const live = useMemo(() => (data?.people ?? []).filter((person) => showArchived || !person.archived), [data, showArchived]);
  const archivedCount = (data?.people ?? []).filter((person) => person.archived).length;
  const visible = useMemo(() => filterPeople(live, query, role), [live, query, role]);
  const sphere = useMemo(() => visible.map(toSpherePerson), [visible]);
  const lines = useMemo(() => toLinesPeople(visible, data?.captures ?? []), [visible, data]);
  const links = useMemo(() => coMentionLinks(data?.captures ?? []), [data]);
  const stats = useMemo(() => peopleStats(live.filter((person) => !person.archived), today), [live, today]);
  const roles = useMemo(() => roleCounts(live), [live]);
  const selected = visible.find((person) => person.id === selectedId) ?? null;

  if (!data) {
    return (
      <div aria-busy="true" className={styles.loading}>
        <Skeleton shape="circle" width={260} height={260} label={t('Loading')} />
        <Skeleton shape="block" height={64} />
      </div>
    );
  }

  const add = (
    <Button variant="secondary" size="sm" iconStart="plus" onClick={() => setCreating(true)}>
      {t('Add a person')}
    </Button>
  );

  return (
    <div className={styles.view}>
      {live.length === 0 ? (
        <EmptyState
          illustration="constellation"
          title={t('Mention someone in a record and the person appears here on their own.')}
          description={t('You can also add one by hand: name, role and a few notes.')}
          action={add}
        />
      ) : (
        <>
          <div className={styles.toolbar}>
            <SegmentedControl<Mode>
              size="sm"
              aria-label={t('People view')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'sphere', label: t('Sphere') },
                { value: 'lines', label: t('Lines') },
              ]}
            />
            {add}
          </div>

          <section className={styles.hero} aria-label={mode === 'sphere' ? t('People sphere') : t('People lines')}>
            {visible.length === 0 ? (
              <Body tone="muted" className={styles.noMatch}>
                {t('Nobody found. Try another name or reset the filter.')}
              </Body>
            ) : mode === 'sphere' ? (
              <PeopleSphere people={sphere} links={links} selectedId={selectedId} onSelect={setSelectedId} size={phone ? 320 : 380} />
            ) : (
              <PeopleLines people={lines} selectedId={selectedId} onSelect={setSelectedId} />
            )}
            <ul className={styles.stats} aria-label={t('Summary')}>
              <li>
                <strong>{peopleCountLabel(stats.total)}</strong>
              </li>
              <li>{t('active in 30 days: {active}', { active: stats.active })}</li>
              <li>{t('not written to for a while: {dormant}', { dormant: stats.dormant })}</li>
            </ul>
            {selected ? (
              <div className={styles.picked}>
                <Avatar name={selected.name} />
                <div className={styles.pickedText}>
                  <strong>{selected.name}</strong>
                  <Caption>
                    {ROLE_LABELS[selected.role]} · {lastMentionLabel(selected, today)}
                  </Caption>
                </div>
                <Button variant="secondary" size="sm" {...openProps(link(`/people/${selected.id}`))}>
                  {t('Open', undefined, 'people-view')}
                </Button>
              </div>
            ) : (
              <Caption>{t('Tap a dot on the sphere: I will show who the person is mentioned with.')}</Caption>
            )}
          </section>

          <div className={styles.filters}>
            <Search value={query} onChange={setQuery} placeholder={t('Find a person')} aria-label={t('Search people')} />
            <div className={styles.roleRow} role="group" aria-label={t('Role')}>
              <Chip selected={role === 'all'} onClick={() => setRole('all')} count={live.length}>
                {t('All')}
              </Chip>
              {roles.map((entry) => (
                <Chip key={entry.role} selected={role === entry.role} onClick={() => setRole(entry.role)} count={entry.count}>
                  {ROLE_LABELS[entry.role]}
                </Chip>
              ))}
              {archivedCount > 0 ? (
                <Chip selected={showArchived} onClick={() => setShowArchived((v) => !v)} count={archivedCount}>
                  {t('Archive')}
                </Chip>
              ) : null}
            </div>
          </div>

          <ul className={styles.list} aria-label={t('People')}>
            {visible.map((person) => (
              <ListRow
                key={person.id}
                as="li"
                className={cx(person.archived && styles.archived)}
                selected={person.id === selectedId}
                leading={<Avatar name={person.name} />}
                title={person.name}
                subtitle={`${ROLE_LABELS[person.role]} · ${mentionsCount(person.mentionCount)}${person.archived ? t(' · archived') : ''}`}
                meta={lastMentionLabel(person, today)}
                {...link(`/people/${person.id}`)}
              />
            ))}
          </ul>
        </>
      )}
      <PersonFormSheet open={creating} onClose={() => setCreating(false)} onSaved={(person) => setSelectedId(person.id)} />
    </div>
  );
}

/** A Button has no `href`: it only needs the click handler of a link props object. */
function openProps(props: { onClick: (event: React.MouseEvent<HTMLElement>) => void }) {
  return { onClick: props.onClick as React.MouseEventHandler<HTMLButtonElement> };
}
