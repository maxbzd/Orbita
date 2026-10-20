import { useState } from 'react';
import { Button, Caption, Field } from '../../ui';
import { maskKey } from './settingsModel';
import styles from './Settings.module.css';
import { t } from '../../i18n';

export interface SecretFieldProps {
  label: string;
  /** The saved key. Shown masked, never in full. */
  value: string;
  hint?: string;
  placeholder?: string;
  onSave(value: string): void | Promise<void>;
}

/**
 * An API key: while saved it shows only `••••••••a3f9` with "Заменить" and "Удалить"; while empty or being replaced
 * it is a password input with "Сохранить". The saved value is never put back into an input.
 */
export function SecretField({ label, value, hint, placeholder, onSave }: SecretFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const saved = value.trim() !== '';

  const run = async (next: string): Promise<void> => {
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
      setDraft('');
    } finally {
      setBusy(false);
    }
  };

  if (saved && !editing) {
    return (
      <div className={styles.secret}>
        <div className={styles.secretText}>
          <span className={styles.rowLabel}>{label}</span>
          <span className={styles.masked} aria-label={t('{label}: saved, hidden', { label })}>
            {maskKey(value)}
          </span>
        </div>
        <div className={styles.inline}>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {t('Replace')}
          </Button>
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void run('')} aria-label={t('Delete: {label}', { label })}>
            {t('Delete')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className={styles.secret}
      onSubmit={(event) => {
        event.preventDefault();
        if (draft.trim() !== '') void run(draft);
      }}
    >
      <Field
        label={label}
        type="password"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={placeholder ?? t('Paste the key')}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        hint={hint}
      />
      <div className={styles.inline}>
        <Button type="submit" size="sm" variant="primary" loading={busy} disabled={draft.trim() === ''}>
          {t('Save the key')}
        </Button>
        {saved ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {t('Cancel', undefined, 'secret-field')}
          </Button>
        ) : null}
      </div>
      <Caption tone="faint">{t('The key stays on this device and goes only to your provider.')}</Caption>
    </form>
  );
}
