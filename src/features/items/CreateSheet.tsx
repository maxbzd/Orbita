import { useEffect, useMemo, useState } from 'react';
import { itemsRepo } from '../../db';
import { usePeople, useProjects } from '../../db/hooks';
import type { Item, ItemKind } from '../../domain/types';
import { Button, Chip, Label, Sheet, TYPE_LABELS, useToast } from '../../ui';
import { draftToNewItem, emptyDraft, validateDraft } from './draft';
import type { ItemDraft } from './draft';
import { ItemForm } from './ItemForm';
import { KIND_ORDER } from './model';
import styles from './CreateSheet.module.css';
import { t } from '../../i18n';

export interface CreateSheetProps {
  open: boolean;
  onClose(): void;
  /** The kind to start with; without one the sheet asks first. */
  kind?: ItemKind;
  /** Called with the new object after it is saved. */
  onCreated(item: Item): void;
}

/** «+»: an object by hand. The kind can be changed until the first save; what was typed stays. */
export function CreateSheet({ open, onClose, kind, onCreated }: CreateSheetProps) {
  const [draft, setDraft] = useState<ItemDraft>(() => emptyDraft(kind ?? 'task'));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const people = usePeople();
  const projects = useProjects();
  const toast = useToast();
  const names = useMemo(() => new Map((people ?? []).map((person) => [person.id, person.name])), [people]);

  // A fresh form every time the sheet opens.
  useEffect(() => {
    if (open) {
      setDraft(emptyDraft(kind ?? 'task'));
      setError(null);
    }
  }, [open, kind]);

  const changeKind = (next: ItemKind): void => setDraft((current) => ({ ...emptyDraft(next), title: current.title, body: current.body }));

  const create = async (): Promise<void> => {
    const problem = validateDraft(draft);
    setError(problem);
    if (problem) return;
    setSaving(true);
    try {
      const item = await itemsRepo.create(draftToNewItem(draft, names));
      toast.show({ message: t('{v} added.', { v: TYPE_LABELS[item.kind] }) });
      onCreated(item);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('New object')}
      placement="panel"
      snaps={[0.7, 0.92]}
      defaultSnapIndex={1}
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" size="md" onClick={onClose}>
            {t('Cancel', undefined, 'create-sheet')}
          </Button>
          <Button variant="primary" size="md" loading={saving} onClick={() => void create()}>
            {t('Add')}
          </Button>
        </div>
      }
    >
      <div className={styles.body}>
        <div className={styles.kinds}>
          <Label as="span">{t('What it is')}</Label>
          <div className={styles.chips} role="group" aria-label={t('Object type')}>
            {KIND_ORDER.map((option) => (
              <Chip key={option} type={option} selected={draft.kind === option} onClick={() => changeKind(option)}>
                {TYPE_LABELS[option]}
              </Chip>
            ))}
          </div>
        </div>
        <ItemForm draft={draft} onChange={setDraft} people={people ?? []} projects={projects ?? []} error={error} autoFocusTitle />
      </div>
    </Sheet>
  );
}
