import { useEffect, useMemo, useRef, useState } from 'react';
import { itemsRepo } from '../../db';
import { useItem, useItems, usePeople, useProjects } from '../../db/hooks';
import { nowISO } from '../../domain/dates';
import type { ID, Item, ItemKind, ItemStatus } from '../../domain/types';
import { Button, Display, Pill, Sheet, Skeleton, TYPE_LABELS, TypeMedallion, useToast } from '../../ui';
import { draftFromItem, draftToPatch, validateDraft } from './draft';
import type { ItemDraft } from './draft';
import { ItemDetails } from './ItemDetails';
import { ItemForm } from './ItemForm';
import { DecisionPanel, FactPanel, IdeaPanel, PredictionPanel, QuestionPanel } from './KindPanels';
import { useRelated, useToday } from './hooks';
import type { RelatedEntity } from './hooks';
import { ITEM_STATUS_LABELS, dueInfo } from './model';
import styles from './ItemSheet.module.css';
import { t } from '../../i18n';

export interface ItemSheetProps {
  /** The object to show; the sheet is closed without one. */
  itemId: ID | undefined;
  onClose(): void;
  /** Opens another object (a link, a new task). */
  onOpenItem(id: ID, kind?: ItemKind): void;
  /** Opens a non-object (a capture, a person) in its own screen. */
  onOpenEntity(entity: RelatedEntity): void;
}

const STATUS_TONE = { proposed: 'ai', active: 'neutral', done: 'ok', dropped: 'neutral', dismissed: 'neutral' } as const;

interface StatusAction {
  label: string;
  status: ItemStatus;
  message: string;
}

/** What closing means for the kind; decisions and forecasts are closed in their own panels. */
function closeActions(item: Item): StatusAction[] {
  switch (item.kind) {
    case 'commitment':
      return [
        { label: t('Fulfilled'), status: 'done', message: t('Closed.') },
        { label: t('Not relevant'), status: 'dropped', message: t('Removed from open items.') },
      ];
    case 'task':
      return [
        { label: t('Done'), status: 'done', message: t('Done.') },
        { label: t('Not relevant'), status: 'dropped', message: t('Removed from open items.') },
      ];
    case 'idea':
      return [{ label: t('Implemented'), status: 'done', message: t('The idea is marked as done.') }];
    default:
      return [{ label: t('Not relevant'), status: 'dropped', message: t('Removed from open items.') }];
  }
}

/** The object in a sheet: fields, source, links, the kind's own actions, status, edit, delete (with «Вернуть»). */
export function ItemSheet({ itemId, onClose, onOpenItem, onOpenEntity }: ItemSheetProps) {
  const loaded = useItem(itemId);
  // Keep the last object on screen while the sheet slides away.
  const last = useRef<Item | null>(null);
  if (loaded) last.current = loaded;
  const item = itemId ? (loaded ?? last.current) : last.current;
  const open = itemId !== undefined;

  const people = usePeople({ includeArchived: true });
  const projects = useProjects();
  const ideas = useItems({ kind: 'idea' });
  const related = useRelated(open ? loaded : null);
  const today = useToday();
  const now = useMemo(() => nowISO(), [today, loaded?.updatedAt]);
  const toast = useToast();

  const [draft, setDraft] = useState<ItemDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(null);
    setError(null);
  }, [itemId]);

  const editing = draft !== null;
  const peopleNames = useMemo(() => new Map((people ?? []).map((person) => [person.id, person.name])), [people]);

  const changeStatus = async (target: Item, action: StatusAction): Promise<void> => {
    const before = target.status;
    await itemsRepo.setStatus(target.id, action.status);
    toast.show({ message: action.message, actionLabel: t('Restore'), onAction: () => void itemsRepo.setStatus(target.id, before) });
  };

  const save = async (target: Item): Promise<void> => {
    if (!draft) return;
    const problem = validateDraft(draft);
    setError(problem);
    if (problem) return;
    setSaving(true);
    try {
      await itemsRepo.update(target.id, draftToPatch(draft, peopleNames));
      setDraft(null);
      toast.show({ message: t('Saved.', undefined, 'item-sheet') });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (target: Item): Promise<void> => {
    await itemsRepo.remove(target.id);
    onClose();
    toast.show({ message: t('Deleted.'), actionLabel: t('Restore'), onAction: () => void itemsRepo.restore(target.id) });
  };

  const close = (): void => {
    setDraft(null);
    onClose();
  };

  const footer =
    item && editing ? (
      <div className={styles.footer}>
        <Button variant="ghost" size="md" onClick={() => { setDraft(null); setError(null); }}>
          {t('Cancel', undefined, 'item-sheet')}
        </Button>
        <Button variant="primary" size="md" loading={saving} onClick={() => void save(item)}>
          {t('Save')}
        </Button>
      </div>
    ) : undefined;

  return (
    <Sheet open={open} onClose={close} title={item ? TYPE_LABELS[item.kind] : t('Object')} placement="panel" snaps={[0.6, 0.92]} defaultSnapIndex={1} footer={footer}>
      {!item ? (
        itemId !== undefined && loaded === undefined ? (
          <Skeleton shape="block" height={160} label={t('Loading')} />
        ) : (
          <p className={styles.missing}>{t('No such object. It may have been deleted permanently.')}</p>
        )
      ) : (
        <div className={styles.content} data-testid="item-sheet">
          <header className={styles.head}>
            <TypeMedallion kind={item.kind} size={44} />
            <Pill tone={STATUS_TONE[item.status]} dot={item.status === 'proposed'}>
              {ITEM_STATUS_LABELS[item.status]}
            </Pill>
          </header>

          {editing && draft ? (
            <ItemForm draft={draft} onChange={setDraft} people={people ?? []} projects={projects ?? []} error={error} autoFocusTitle />
          ) : (
            <>
              <Display as="h3" size="l" className={styles.title}>
                {item.title}
              </Display>
              {item.deletedAt ? <p className={styles.missing}>{t('The object is in the trash.')}</p> : null}
              {/* The thing to do comes first: closing a forecast, reviewing a decision, answering a question. */}
              {item.kind === 'prediction' ? <PredictionPanel item={item} due={(dueInfo(item, today)?.days ?? 1) <= 0} /> : null}
              {item.kind === 'decision' ? <DecisionPanel item={item} due={(dueInfo(item, today)?.days ?? 1) <= 0} /> : null}
              {item.kind === 'question' ? <QuestionPanel item={item} /> : null}
              <ItemDetails
                item={item}
                today={today}
                now={now}
                people={people ?? []}
                projects={projects ?? []}
                related={related ?? []}
                onOpenRelated={(entity) => (entity.kind ? onOpenItem(entity.id, entity.kind) : onOpenEntity(entity))}
              />

              {item.kind === 'idea' ? <IdeaPanel item={item} ideas={ideas ?? []} onOpen={(id, kind) => onOpenItem(id, kind)} /> : null}
              {item.kind === 'fact' ? <FactPanel item={item} /> : null}

              <div className={styles.actions}>
                {item.status === 'proposed' ? (
                  <>
                    <Button variant="primary" size="md" onClick={() => void itemsRepo.accept(item.id)}>
                      {t('Accept')}
                    </Button>
                    <Button variant="ghost" size="md" onClick={() => void itemsRepo.dismiss(item.id)}>
                      {t('Dismiss')}
                    </Button>
                  </>
                ) : item.status === 'active' ? (
                  closeActions(item).map((action, index) => (
                    <Button key={action.label} variant={index === 0 ? 'secondary' : 'ghost'} size="md" onClick={() => void changeStatus(item, action)}>
                      {action.label}
                    </Button>
                  ))
                ) : item.status === 'done' || item.status === 'dropped' ? (
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      const before = item.status;
                      void itemsRepo.reopen(item.id).then(() =>
                        toast.show({ message: t('Back in progress.'), actionLabel: t('Cancel'), onAction: () => void itemsRepo.setStatus(item.id, before) }),
                      );
                    }}
                  >
                    {t('Reopen')}
                  </Button>
                ) : null}
              </div>
              <div className={styles.actions}>
                <Button variant="ghost" size="md" iconStart="edit" onClick={() => setDraft(draftFromItem(item))}>
                  {t('Edit', undefined, 'item-sheet')}
                </Button>
                <Button variant="ghost" size="md" iconStart="trash" onClick={() => void remove(item)}>
                  {t('Delete')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
