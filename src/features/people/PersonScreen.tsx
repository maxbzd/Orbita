import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { capturesRepo, checkinsRepo, itemsRepo, peopleRepo } from '../../db';
import { formatDayWithWeekday, formatTime, localDayKey } from '../../domain/dates';
import { daysCount, mentionsCount } from '../../domain/counts';
import { t } from '../../i18n';
import type { Capture, ItemOfKind } from '../../domain/types';
import {
  Body,
  Button,
  Caption,
  ConfirmDialog,
  Display,
  EmptyState,
  IconButton,
  Label,
  ListRow,
  ROLE_LABELS,
  Sheet,
  Skeleton,
  Sparkline,
  TextArea,
  TypeMedallion,
  useToast,
} from '../../ui';
import { useLinkProps } from '../orbit/useLink';
import { Avatar } from './PeopleView';
import { PersonFormSheet } from './PersonFormSheet';
import { commitmentsOf, dueText, lastMentionLabel, mergeCandidates, relationSeries, relationWord } from './model';
import styles from './People.module.css';

const TIMELINE_LIMIT = 12;

async function loadPerson(personId: string) {
  const person = await peopleRepo.get(personId);
  if (!person || person.deletedAt !== undefined) return { person: null } as const;
  const [captures, commitments, facts, others] = await Promise.all([
    capturesRepo.list({ personId }),
    itemsRepo.listByKind('commitment'),
    itemsRepo.list({ personId, kind: 'fact' }),
    peopleRepo.list(),
  ]);
  const first = captures[captures.length - 1]?.day;
  const checkIns = first ? await checkinsRepo.listRange(first, localDayKey()) : [];
  return { person, captures, commitments, facts: facts.filter((fact) => fact.status === 'active'), others, checkIns } as const;
}

function groupByDay(captures: readonly Capture[]): Array<{ day: string; captures: Capture[] }> {
  const groups: Array<{ day: string; captures: Capture[] }> = [];
  for (const capture of captures) {
    const last = groups[groups.length - 1];
    if (last?.day === capture.day) last.captures.push(capture);
    else groups.push({ day: capture.day, captures: [capture] });
  }
  return groups;
}

/** Карточка человека (SPEC §4.9). */
export default function PersonScreen() {
  const { personId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const link = useLinkProps();
  const data = useLiveQuery(() => loadPerson(personId), [personId]);
  const [editing, setEditing] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<{ id: string; name: string } | null>(null);
  const [notesDraft, setNotesDraft] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const today = localDayKey();

  const person = data?.person ?? undefined;
  const notes = person?.notes ?? '';
  useEffect(() => setNotesDraft(null), [personId]);

  const groups = useMemo(() => groupByDay(data?.captures ?? []), [data]);
  const series = useMemo(() => (data?.person ? relationSeries(data.person.id, data.captures ?? [], data.checkIns ?? []) : []), [data]);
  const open = useMemo(() => (data?.person ? commitmentsOf(data.person.id, data.commitments ?? []) : { iOwe: [], owedToMe: [] }), [data]);

  if (!data) {
    return (
      <section className={styles.screen} aria-busy="true">
        <Skeleton shape="circle" width={72} height={72} label={t('Loading')} />
        <Skeleton shape="block" height={120} />
      </section>
    );
  }
  if (!person) {
    return (
      <section className={styles.screen}>
        <EmptyState
          illustration="none"
          title={t('No such person.')}
          description={t('They may have been merged with someone else or removed.')}
          action={
            <Button variant="secondary" onClick={() => navigate('/people')}>
              {t('To people')}
            </Button>
          }
        />
      </section>
    );
  }

  const dirty = notesDraft !== null && notesDraft !== notes;
  const saveNotes = async (): Promise<void> => {
    if (notesDraft === null) return;
    await peopleRepo.update(person.id, { notes: notesDraft.trim() === '' ? undefined : notesDraft.trim() });
    setNotesDraft(null);
    toast.show({ message: t('Notes saved.'), tone: 'ok' });
  };

  const toggleArchive = async (): Promise<void> => {
    if (person.archived) {
      await peopleRepo.unarchive(person.id);
      toast.show({ message: t('{name} is back in the list.', { name: person.name }), tone: 'ok' });
      return;
    }
    await peopleRepo.archive(person.id);
    toast.show({ message: t('{name} is archived.', { name: person.name }), actionLabel: t('Restore'), onAction: () => void peopleRepo.unarchive(person.id) });
  };

  const merge = async (): Promise<void> => {
    if (!mergeTarget) return;
    const target = mergeTarget;
    setMergeTarget(null);
    setMerging(false);
    try {
      await peopleRepo.merge(person.id, target.id);
      toast.show({ message: t('{name} is now under the card “{name2}”; the former name became an alias.', { name: person.name, name2: target.name }), tone: 'ok' });
      navigate(`/people/${target.id}`, { replace: true });
    } catch (cause) {
      toast.show({ message: cause instanceof Error ? cause.message : t('Could not merge.'), tone: 'danger' });
    }
  };

  const shownGroups = showAll ? groups : groups.slice(0, TIMELINE_LIMIT);
  const hiddenDays = groups.length - shownGroups.length;
  const candidates = mergeCandidates(person, data.others ?? []);
  const realSeries = series.filter((value) => value !== null);

  return (
    <section className={styles.screen} aria-labelledby="person-title">
      <div className={styles.back}>
        <IconButton icon="chevron-left" label={t('To people')} onClick={() => navigate('/people')} />
      </div>

      <header className={styles.card}>
        <Avatar name={person.name} size={72} />
        <Display as="h1" size="l" id="person-title" className={styles.name}>
          {person.name}
        </Display>
        <Caption>
          {ROLE_LABELS[person.role]} · {mentionsCount(person.mentionCount)} · {lastMentionLabel(person, today)}
          {person.archived ? t(' · archived') : ''}
        </Caption>
        {person.aliases.length > 0 ? <Caption>{t('Also: {v}', { v: person.aliases.join(', ') })}</Caption> : null}
        <div className={styles.actions}>
          <Button variant="primary" iconStart="ask" onClick={() => navigate(`/context?person=${person.id}`)}>
            {t('Prepare for a conversation')}
          </Button>
          <Button variant="secondary" iconStart="edit" onClick={() => setEditing(true)}>
            {t('Edit')}
          </Button>
        </div>
      </header>

      <section className={styles.block} aria-labelledby="notes-title">
        <Label as="h2" tone="strong" id="notes-title">
          {t('Notes')}
        </Label>
        <TextArea
          aria-label={t('Notes about the person')}
          value={notesDraft ?? notes}
          onChange={(event) => setNotesDraft(event.target.value)}
          autoGrow
          rows={3}
          placeholder={t('What is worth remembering about this person')}
        />
        {dirty ? (
          <div className={styles.rowEnd}>
            <Button variant="ghost" size="sm" onClick={() => setNotesDraft(null)}>
              {t('Cancel')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => void saveNotes()}>
              {t('Save notes')}
            </Button>
          </div>
        ) : null}
      </section>

      <section className={styles.block} aria-labelledby="relation-title">
        <Label as="h2" tone="strong" id="relation-title">
          {t('Relationship')}
        </Label>
        <div className={styles.relation}>
          <Body>{t('Now: {relationWord}.', { relationWord: relationWord(person.relationMood) })}</Body>
          {realSeries.length >= 2 ? (
            <Sparkline values={series} domain={[-1, 1]} width={140} height={36} area={false} color="var(--type-person, var(--ink-2))" summary={t('Mood on days of conversations, from earliest to latest')} />
          ) : null}
        </div>
        <Caption tone="faint">
          {realSeries.length >= 2 ? t('Line: your state on days when this person was mentioned.') : t('The line appears once a state is logged on days of conversations.')}
        </Caption>
      </section>

      <section className={styles.block} aria-labelledby="open-title">
        <Label as="h2" tone="strong" id="open-title">
          {t('Open commitments')}
        </Label>
        <CommitmentGroup title={t('I owe')} items={open.iOwe} today={today} empty={t('You owe nothing.')} link={link} />
        <CommitmentGroup title={t('Owed to me')} items={open.owedToMe} today={today} empty={t('Nobody owes you anything.')} link={link} />
      </section>

      {data.facts && data.facts.length > 0 ? (
        <section className={styles.block} aria-labelledby="facts-title">
          <Label as="h2" tone="strong" id="facts-title">
            {t('Facts')}
          </Label>
          <ul className={styles.rows} aria-label={t('Facts about the person')}>
            {data.facts.map((fact) => (
              <ListRow key={fact.id} as="li" leading={<TypeMedallion kind="fact" />} title={fact.title} subtitle={fact.kind === 'fact' ? fact.value : undefined} {...(fact.captureId ? link(`/entry/${fact.captureId}`) : {})} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className={styles.block} aria-labelledby="timeline-title">
        <Label as="h2" tone="strong" id="timeline-title">
          {t('Timeline of mentions')}
        </Label>
        {groups.length === 0 ? (
          <Body tone="muted">{t('No records with this person yet.')}</Body>
        ) : (
          <>
            {shownGroups.map((group) => (
              <div key={group.day} className={styles.dayGroup}>
                <Caption className={styles.dayTitle}>{formatDayWithWeekday(group.day)}</Caption>
                <ul className={styles.rows} aria-label={formatDayWithWeekday(group.day)}>
                  {group.captures.map((capture) => (
                    <ListRow
                      key={capture.id}
                      as="li"
                      title={capture.title?.trim() || (capture.summary ?? capture.text).slice(0, 80) || t('Record without text')}
                      subtitle={capture.summary && capture.title ? capture.summary : undefined}
                      meta={formatTime(capture.createdAt)}
                      {...link(`/entry/${capture.id}`)}
                    />
                  ))}
                </ul>
              </div>
            ))}
            {hiddenDays > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setShowAll(true)}>
                {t('Show {days} more', { days: daysCount(hiddenDays) })}
              </Button>
            ) : null}
          </>
        )}
      </section>

      <section className={styles.block} aria-label={t('Other actions')}>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={() => setMerging(true)} disabled={candidates.length === 0}>
            {t('Merge with another person')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void toggleArchive()}>
            {person.archived ? t('Restore from archive') : t('Archive', undefined, 'person-screen')}
          </Button>
        </div>
      </section>

      <PersonFormSheet open={editing} onClose={() => setEditing(false)} person={person} />

      <Sheet open={merging} onClose={() => setMerging(false)} title={t('Merge duplicates')} description={t('Choose whose card stays. Everything linked to “{name}” moves to it.', { name: person.name })}>
        <ul className={styles.rows} aria-label={t('Who to keep')}>
          {candidates.map(({ person: other, likely }) => (
            <ListRow
              key={other.id}
              as="li"
              leading={<Avatar name={other.name} />}
              title={other.name}
              subtitle={`${ROLE_LABELS[other.role]}${likely ? t(' · looks like a duplicate') : ''}`}
              meta={String(other.mentionCount)}
              onClick={() => setMergeTarget({ id: other.id, name: other.name })}
            />
          ))}
        </ul>
      </Sheet>

      <ConfirmDialog
        open={mergeTarget !== null}
        title={mergeTarget ? t('Merge with “{name}”?', { name: mergeTarget.name }) : ''}
        message={t('Records, commitments and facts of “{name}” will move to “{v}”, and {name2} becomes another name for them. This cannot be undone.', { name: person.name, v: mergeTarget?.name ?? '', name2: person.name })}
        confirmLabel={t('Merge')}
        danger
        onConfirm={() => void merge()}
        onCancel={() => setMergeTarget(null)}
      />
    </section>
  );
}

function CommitmentGroup({
  title,
  items,
  today,
  empty,
  link,
}: {
  title: string;
  items: ItemOfKind<'commitment'>[];
  today: string;
  empty: string;
  link: ReturnType<typeof useLinkProps>;
}) {
  return (
    <div className={styles.commitments}>
      <Caption className={styles.dayTitle}>
        {title} · {items.length}
      </Caption>
      {items.length === 0 ? (
        <Body tone="muted">{empty}</Body>
      ) : (
        <ul className={styles.rows} aria-label={title}>
          {items.map((item) => {
            const due = dueText(item.dueAt, today);
            return (
              <ListRow
                key={item.id}
                as="li"
                leading={<TypeMedallion kind="commitment" />}
                title={item.title}
                subtitle={due.overdue ? due.text : undefined}
                meta={due.overdue ? t('overdue') : due.text}
                tone={due.overdue ? 'danger' : 'default'}
                {...(item.captureId ? link(`/entry/${item.captureId}`) : link('/items/commitment'))}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

export { PersonScreen };
