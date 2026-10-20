import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { peopleRepo } from '../../db';
import { normalizeName } from '../../domain/names';
import { PERSON_ROLES } from '../../domain/types';
import type { Person, PersonRole } from '../../domain/types';
import { Body, Button, Chip, Field, ROLE_LABELS, Sheet, TextArea, useToast } from '../../ui';
import { parseAliases } from './model';
import styles from './People.module.css';
import { t } from '../../i18n';

interface PersonFormSheetProps {
  open: boolean;
  onClose(): void;
  /** Editing this person; without it a new one is created. */
  person?: Person;
  /** Called with the saved person. */
  onSaved?(person: Person): void;
}

/** Create a person by hand, or edit the name, the role, the aliases and the notes of an existing one. */
export function PersonFormSheet({ open, onClose, person, onSaved }: PersonFormSheetProps) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [role, setRole] = useState<PersonRole>('other');
  const [aliases, setAliases] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(person?.name ?? '');
    setRole(person?.role ?? 'other');
    setAliases((person?.aliases ?? []).join(', '));
    setNotes(person?.notes ?? '');
    setError(null);
    setBusy(false);
  }, [open, person]);

  const submit = async (event?: FormEvent): Promise<void> => {
    event?.preventDefault();
    if (name.trim() === '') {
      setError(t('Write a name'));
      return;
    }
    setBusy(true);
    try {
      // A renamed person is still recognised by the old name.
      const renamed = person !== undefined && normalizeName(person.name) !== normalizeName(name);
      const fields = {
        name,
        role,
        aliases: [...parseAliases(aliases), ...(renamed ? [person.name] : [])],
        notes: notes.trim() === '' ? undefined : notes.trim(),
      };
      const saved = person ? await peopleRepo.update(person.id, fields) : await peopleRepo.create(fields);
      toast.show({ message: person ? t('Saved.', undefined, 'person-form-sheet') : t('{name} added.', { name: saved.name }), tone: 'ok' });
      onSaved?.(saved);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not save. Try again.'));
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={person ? t('Edit person') : t('New person')}
      footer={
        <Button variant="primary" fullWidth loading={busy} onClick={() => void submit()}>
          {t('Save')}
        </Button>
      }
    >
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <Field label={t('Name', undefined, 'person-form-sheet')} value={name} onChange={(event) => setName(event.target.value)} error={error} autoComplete="off" maxLength={80} />
        <fieldset className={styles.roles}>
          <legend className={styles.legend}>{t('Who is it')}</legend>
          <div className={styles.roleChips} role="radiogroup" aria-label={t('Role')}>
            {PERSON_ROLES.map((value) => (
              <Chip key={value} selected={role === value} onClick={() => setRole(value)} role="radio" aria-checked={role === value}>
                {ROLE_LABELS[value]}
              </Chip>
            ))}
          </div>
        </fieldset>
        <Field label={t('Other names')} hint={t('Comma-separated: the transcript will recognise them too (Sam, Sammy).')} value={aliases} onChange={(event) => setAliases(event.target.value)} autoComplete="off" />
        <TextArea label={t('Notes')} value={notes} onChange={(event) => setNotes(event.target.value)} autoGrow rows={3} placeholder={t('What is worth remembering about this person')} />
        <Body tone="muted" as="p">
          {t('Notes are visible only to you. They go into the AI context only when you pick this section yourself.')}
        </Body>
        <button type="submit" hidden />
      </form>
    </Sheet>
  );
}
