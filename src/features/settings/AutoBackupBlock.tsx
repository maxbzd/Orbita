import { useEffect, useState } from 'react';
import { updateSettings } from '../../db';
import { runAutoBackup } from '../../db/autoBackup';
import { createAutoBackupKey } from '../../db/backupKey';
import { useSettings } from '../../db/hooks';
import { formatDayShort, formatTime, localDayKey } from '../../domain/dates';
import { folderAccess, folderBackupSupported, forgetFolder, pickFolder } from '../../lib/folder';
import { Body, Button, Field, Sheet, useToast } from '../../ui';
import { Row } from './Group';
import styles from './Settings.module.css';
import { t } from '../../i18n';

const MIN = 8;

function when(at: number | undefined): string {
  if (!at) return t('not yet');
  const iso = new Date(at).toISOString();
  const day = localDayKey(iso) === localDayKey(new Date()) ? t('today') : formatDayShort(localDayKey(iso));
  return `${day}, ${formatTime(iso)}`;
}

function Setup({ onDone }: { onDone(): void }) {
  const toast = useToast();
  const [phrase, setPhrase] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choose = async (): Promise<void> => {
    if (phrase.length < MIN) return setError(t('Use at least {n} characters.', { n: MIN }));
    if (phrase !== repeat) return setError(t('The two entries do not match.'));
    setBusy(true);
    setError(null);
    try {
      const folder = await pickFolder();
      if (!folder) return;
      await updateSettings({ autoBackup: { ...(await createAutoBackupKey(phrase)), folder: folder.name, everyDays: 1 } });
      const result = await runAutoBackup({ force: true });
      toast.show({ message: result === 'written' ? t('The first copy is saved') : t('Automatic copies are on'), tone: 'ok', duration: 4000 });
      onDone();
    } catch {
      setError(t("Couldn't set up the folder"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={styles.sheetBody}
      onSubmit={(event) => {
        event.preventDefault();
        void choose();
      }}
    >
      <Body tone="muted">{t('Choose a folder and a passphrase. Each copy is sealed so that only the passphrase opens it; the app keeps no secret, so a copy can be made without asking you. If you forget the passphrase, the copies cannot be opened.')}</Body>
      <Field label={t('Passphrase for the copies')} type="password" autoComplete="new-password" value={phrase} onChange={(event) => setPhrase(event.target.value)} />
      <Field label={t('Repeat')} type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} />
      {error ? (
        <Body role="alert" className={styles.resultBad}>
          {error}
        </Body>
      ) : null}
      <Button type="submit" variant="primary" fullWidth loading={busy}>
        {t('Choose a folder')}
      </Button>
    </form>
  );
}

/** Settings → Data: automatic encrypted copies into a folder (browsers that let a page write to one). */
export function AutoBackupBlock() {
  const toast = useToast();
  const settings = useSettings();
  const auto = settings?.autoBackup ?? null;
  const [setup, setSetup] = useState(false);
  const [access, setAccess] = useState<string>('none');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (auto) void folderAccess().then(setAccess).catch(() => setAccess('none'));
  }, [auto]);

  if (!folderBackupSupported()) {
    return (
      <Row label={t('Automatic copies')} hint={t('Needs Chrome, Edge or Android Chrome. Elsewhere, download a copy now and then.')}>
        {null}
      </Row>
    );
  }

  const now = async (): Promise<void> => {
    setBusy(true);
    try {
      setAccess(await folderAccess(true));
      const result = await runAutoBackup({ force: true });
      toast.show({ message: result === 'written' ? t('Backup saved') : t("Couldn't save the backup"), tone: result === 'written' ? 'ok' : 'danger', duration: 4000 });
    } finally {
      setBusy(false);
    }
  };

  const off = async (): Promise<void> => {
    await forgetFolder();
    await updateSettings({ autoBackup: null });
    toast.show({ message: t('Automatic copies are off'), duration: 3000 });
  };

  return (
    <>
      {auto ? (
        <Row label={t('Automatic copies')} hint={t('Every day into “{folder}”, the last 14 are kept. Last copy: {when}. Recordings and API keys are not included.', { folder: auto.folder, when: when(auto.lastAt) })}>
          <div className={styles.inline}>
            <Button size="sm" variant={access === 'granted' ? 'secondary' : 'primary'} loading={busy} onClick={() => void now()}>
              {access === 'granted' ? t('Back up now') : t('Allow access')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void off()}>
              {t('Turn off')}
            </Button>
          </div>
        </Row>
      ) : (
        <Row label={t('Automatic copies')} hint={t('A new encrypted copy goes into a folder you choose every day, and the last 14 are kept. Recordings and API keys are not included.')}>
          <div className={styles.inline}>
            <Button size="sm" variant="secondary" onClick={() => setSetup(true)}>
              {t('Set up')}
            </Button>
          </div>
        </Row>
      )}
      <Sheet open={setup} onClose={() => setSetup(false)} title={t('Automatic copies')} placement="sheet" snaps={[0.7]}>
        {setup ? <Setup onDone={() => setSetup(false)} /> : null}
      </Sheet>
    </>
  );
}
