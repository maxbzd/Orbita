import { useEffect, useState } from 'react';
import type { Item } from '../../domain/types';
import { Button, Field, Sheet, TextArea } from '../../ui/primitives';
import styles from './Review.module.css';
import { t } from '../../i18n';

export interface EditItemSheetProps {
  item: Item | null;
  onClose(): void;
  /** Saves the edit and accepts the object in one write. */
  onSave(item: Item, edits: { title: string; body: string | undefined }): void;
}

/** Swipe up / ✎: fix the wording, then accept. */
export function EditItemSheet({ item, onClose, onSave }: EditItemSheetProps) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    setTitle(item?.title ?? '');
    setBody(item?.body ?? '');
  }, [item]);

  const empty = title.trim() === '';
  const save = (): void => {
    if (item && !empty) onSave(item, { title: title.trim(), body: body.trim() === '' ? undefined : body.trim() });
  };

  return (
    <Sheet
      open={item !== null}
      onClose={onClose}
      title={t('Edit and accept')}
      placement="auto"
      snaps={[0.62, 0.92]}
      defaultSnapIndex={0}
      footer={
        <Button variant="primary" fullWidth iconStart="check" disabled={empty} onClick={save}>
          {t('Save and accept')}
        </Button>
      }
    >
      <div className={styles.editForm}>
        <Field
          label={t('Essence')}
          data-autofocus=""
          value={title}
          maxLength={120}
          error={empty ? t('The essence cannot be empty') : undefined}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              save();
            }
          }}
        />
        <TextArea label={t('Details')} rows={4} autoGrow value={body} onChange={(event) => setBody(event.target.value)} />
      </div>
    </Sheet>
  );
}
