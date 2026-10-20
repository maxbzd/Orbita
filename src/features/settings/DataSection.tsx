import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { checkAiReadiness, createLlmProvider, describeError } from '../../ai';
import { BackupError, CryptoError, destroyFromTrash, emptyTrash, getSettings, hasDemoData, restoreFromTrash } from '../../db';
import type { ImportMode, TrashEntry } from '../../db';
import { useTrash } from '../../db/hooks';
import { removeDemo, seedDemo } from '../../db/seed';
import { formatDayShort, localDayKey } from '../../domain/dates';
import { Body, Button, Caption, Field, ListRow, SegmentedControl, Sheet, Toggle, useToast } from '../../ui';
import { Group, Row } from './Group';
import { TypedConfirm } from './TypedConfirm';
import { backupSummaryLine } from './settingsModel';
import {
  countRawMaterial,
  deleteRawMaterial,
  downloadText,
  eraseAll,
  makeEncryptedBackup,
  makePlainBackup,
  previewBackup,
  recomputeDerived,
  runImport,
} from './dataActions';
import type { BackupPreview, RawCleanup } from './dataActions';
import { ConfirmSheet } from './ConfirmSheet';
import styles from './Settings.module.css';
import { t } from '../../i18n';

const errorText = (error: unknown): string => {
  if (error instanceof BackupError || error instanceof CryptoError) return error.message;
  return error instanceof Error ? error.message : t('That did not work. Try again.');
};

const TABLE_LABELS: Record<TrashEntry['table'], string> = {
  get captures() { return t('Record') },
  get items() { return t('Object') },
  get people() { return t('Person') },
  get projects() { return t('Project') },
  get checkins() { return t('State') },
  get patterns() { return t('Pattern') },
  get reviews() { return t('Review') },
};

// ───────── Export ─────────

function ExportBlock() {
  const toast = useToast();
  const [withAudio, setWithAudio] = useState(false);
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const plain = async (): Promise<void> => {
    setBusy(true);
    try {
      const file = await makePlainBackup(withAudio);
      downloadText(file.fileName, file.text);
      toast.show({ message: t('Copy saved. API keys are not included.'), duration: 4000 });
    } catch (cause) {
      toast.show({ message: errorText(cause), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const sealed = async (): Promise<void> => {
    if (password.length < 6) return setError(t('The password is shorter than 6 characters.'));
    if (password !== repeat) return setError(t('The repeat does not match.'));
    setError(null);
    setBusy(true);
    try {
      const file = await makeEncryptedBackup(password, withAudio);
      downloadText(file.fileName, file.text);
      setEncrypt(false);
      setPassword('');
      setRepeat('');
      toast.show({ message: t('Encrypted copy saved. It cannot be opened without the password.'), tone: 'ok', duration: 5000 });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Toggle
        label={t('Add audio to the copy')}
        description={t('The file becomes much larger. Without audio the copy holds all texts, objects, people and settings.')}
        checked={withAudio}
        onChange={setWithAudio}
      />
      <Row label={t('Export')} hint={t('A regular copy is human-readable and has no keys. An encrypted one contains everything, including keys, and opens only with a password.')}>
        <div className={styles.inline}>
          <Button size="sm" variant="secondary" iconStart="share" loading={busy && !encrypt} onClick={() => void plain()}>
            {t('Download a copy (JSON)')}
          </Button>
          <Button size="sm" variant="secondary" iconStart="lock" onClick={() => setEncrypt(true)}>
            {t('Encrypted copy', undefined, 'button')}
          </Button>
        </div>
      </Row>
      <Sheet open={encrypt} onClose={() => setEncrypt(false)} title={t('Encrypted copy')} placement="sheet" snaps={[0.7]}>
        <form
          className={styles.sheetBody}
          onSubmit={(event) => {
            event.preventDefault();
            void sealed();
          }}
        >
          <Body tone="muted">{t('The copy is locked with a password. A forgotten password cannot be recovered: keep it separate from the file.')}</Body>
          <Field label={t('Password for the copy')} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} hint={t('At least 6 characters.')} />
          <Field label={t('Repeat')} type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} />
          {error ? (
            <Body role="alert" className={styles.resultBad}>
              {error}
            </Body>
          ) : null}
          <Button type="submit" variant="primary" fullWidth loading={busy}>
            {t('Download')}
          </Button>
        </form>
      </Sheet>
    </>
  );
}

// ───────── Import ─────────

function ImportBlock() {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<ImportMode>('merge');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const close = (): void => {
    setText(null);
    setPreview(null);
    setPassword('');
    setError(null);
    setMode('merge');
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setError(null);
    try {
      const content = await file.text();
      setText(content);
      setPreview(await previewBackup(content));
    } catch (cause) {
      // The sheet opens with the reason (not a backup, damaged, too new) instead of failing silently.
      setText((current) => current ?? '');
      setError(errorText(cause));
    }
  };

  const unseal = async (): Promise<void> => {
    if (text === null) return;
    setBusy(true);
    try {
      setPreview(await previewBackup(text, password));
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const perform = async (): Promise<void> => {
    if (text === null) return;
    setBusy(true);
    try {
      const report = await runImport(text, mode, preview?.info.encrypted ? password : undefined);
      toast.show({
        message: mode === 'replace' ? t('Data replaced with the copy') : t('Added: {added}, updated: {updated}, unchanged: {skipped}', { added: report.added, updated: report.updated, skipped: report.skipped }),
        tone: 'ok',
        duration: 6000,
      });
      close();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      setConfirmReplace(false);
    }
  };

  const needsPassword = preview !== null && preview.info.encrypted && preview.counts === null;
  return (
    <>
      <Row label={t('Import', undefined, 'data-section')} hint={t('A file from Orbita, regular or encrypted. We show what is inside before loading.')}>
        <div className={styles.inline}>
          <Button size="sm" variant="secondary" iconStart="import" onClick={() => input.current?.click()}>
            {t('Choose a backup file')}
          </Button>
          <input ref={input} type="file" accept="application/json,.json" hidden onChange={(event) => void onFile(event)} aria-label={t('Backup file')} />
        </div>
      </Row>
      <Sheet open={text !== null} onClose={close} title={t('Load the copy')} placement="sheet" snaps={[0.7]}>
        <div className={styles.sheetBody}>
          <Caption>{fileName}</Caption>
          {error ? (
            <Body role="alert" className={styles.resultBad}>
              {error}
            </Body>
          ) : null}
          {needsPassword ? (
            <form
              className={styles.sheetBody}
              style={{ padding: 0 }}
              onSubmit={(event) => {
                event.preventDefault();
                void unseal();
              }}
            >
              <Body tone="muted">{t('The copy is encrypted. Enter the password it was locked with.')}</Body>
              <Field label={t('Copy password')} type="password" autoComplete="off" value={password} onChange={(event) => setPassword(event.target.value)} />
              <Button type="submit" variant="primary" fullWidth loading={busy} disabled={password === ''}>
                {t('Open', undefined, 'data-section')}
              </Button>
            </form>
          ) : null}
          {preview?.counts ? (
            <>
              <Body>
                
                {t('In the copy from {formatDayShort}: {backupSummaryLine} {v}.', { formatDayShort: formatDayShort(localDayKey(preview.info.exportedAt), { withYear: true }), backupSummaryLine: backupSummaryLine(preview.counts), v: preview.counts.audio ? t(', audio: {audio}', { audio: preview.counts.audio }) : '' })}
              
              </Body>
              <SegmentedControl<ImportMode>
                aria-label={t('How to load')}
                options={[
                  { value: 'merge', label: t('Add to mine') },
                  { value: 'replace', label: t('Replace everything') },
                ]}
                value={mode}
                onChange={setMode}
                fullWidth
              />
              <Caption>
                {mode === 'merge'
                  ? t('Nothing will be lost: new items are added, and for matching records the fresher version stays. Your settings stay yours.')
                  : t('All your data on this device will be erased and replaced with the contents of the copy, including settings.')}
              </Caption>
              <Button
                variant={mode === 'replace' ? 'danger' : 'primary'}
                fullWidth
                loading={busy}
                onClick={() => (mode === 'replace' ? setConfirmReplace(true) : void perform())}
              >
                {mode === 'replace' ? t('Replace data') : t('Add data')}
              </Button>
            </>
          ) : null}
        </div>
      </Sheet>
      <TypedConfirm
        open={confirmReplace}
        onClose={() => setConfirmReplace(false)}
        title={t('Replace all data?')}
        description={t('Your records, objects and settings on this device will be deleted and the copy loaded in their place. This cannot be undone.')}
        confirmLabel={t('Replace')}
        onConfirm={perform}
      />
    </>
  );
}

// ───────── Trash ─────────

function TrashBlock() {
  const entries = useTrash();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const count = entries?.length ?? 0;

  return (
    <>
      <div className={styles.rowPad}>
        <ListRow
          title={t('Trash')}
          subtitle={t('Deleted items are kept for 30 days, then disappear for good.')}
          meta={count > 0 ? String(count) : t('empty')}
          onClick={() => setOpen(true)}
        />
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('Trash')} placement="sheet">
        <div className={styles.sheetBody}>
          {count === 0 ? (
            <Body tone="muted">{t('The trash is empty. Deleted records and objects stay here for 30 days: you can restore them.')}</Body>
          ) : (
            <>
              <ul className={styles.list}>
                {entries?.map((entry) => (
                  <li key={`${entry.table}:${entry.id}`} className={styles.trashRow}>
                    <span className={styles.trashText}>
                      <Caption>
                        {t('{v} · deleted {formatDayShort}', { v: TABLE_LABELS[entry.table], formatDayShort: formatDayShort(localDayKey(entry.deletedAt)) })}
                      </Caption>
                      <Body as="span" className={styles.ellipsis}>
                        {entry.title || t('Untitled')}
                      </Body>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={t('Restore: {title}', { title: entry.title })}
                      onClick={() => void restoreFromTrash(entry).then(() => toast.show({ message: t('Restored'), duration: 2000 }))}
                    >
                      {t('Restore')}
                    </Button>
                    <Button size="sm" variant="ghost" aria-label={t('Delete forever: {title}', { title: entry.title })} onClick={() => void destroyFromTrash(entry)}>
                      {t('Erase')}
                    </Button>
                  </li>
                ))}
              </ul>
              <Button variant="danger" fullWidth onClick={() => setConfirmEmpty(true)}>
                {t('Empty the trash')}
              </Button>
            </>
          )}
        </div>
      </Sheet>
      <ConfirmSheet
        open={confirmEmpty}
        onClose={() => setConfirmEmpty(false)}
        title={t('Empty the trash?')}
        message={t('Everything in the trash ({count}) will disappear for good. It cannot be restored.', { count })}
        confirmLabel={t('Empty')}
        onConfirm={async () => {
          await emptyTrash();
          toast.show({ message: t('Trash emptied'), duration: 2500 });
        }}
      />
    </>
  );
}

// ───────── Demo, derived, raw, erase ─────────

function DemoRow() {
  const toast = useToast();
  const [present, setPresent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => void hasDemoData().then(setPresent), []);
  useEffect(refresh, [refresh]);
  if (present === null) return null;

  const run = async (): Promise<void> => {
    setBusy(true);
    try {
      if (present) {
        const removed = await removeDemo();
        toast.show({ message: t('Demo data removed ({removed})', { removed }), duration: 3000 });
      } else {
        await seedDemo();
        toast.show({ message: t('Demo data loaded. It is marked and does not mix with yours.'), duration: 4000 });
      }
    } catch (cause) {
      toast.show({ message: errorText(cause), tone: 'danger' });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <Row
      label={t('Demo data')}
      hint={t('Made-up records, people and reviews, so you can see how every screen looks. One button removes them, your data is not touched.')}
    >
      <div className={styles.inline}>
        <Button size="sm" variant="secondary" loading={busy} onClick={() => void run()}>
          {present ? t('Delete demo data') : t('Load demo data')}
        </Button>
      </div>
    </Row>
  );
}

function DerivedRow() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const ask = async (): Promise<void> => {
    const settings = await getSettings();
    const readiness = checkAiReadiness(settings);
    if (settings.ai.provider === 'manual') setUnavailable(t('Recalculation is unavailable in manual mode: an AI key is needed.'));
    else if (!readiness.ready) setUnavailable(readiness.reason ?? t('Connect the AI first.'));
    else setUnavailable(null);
    setOpen(true);
  };

  return (
    <>
      <Row
        label={t('Recalculate AI conclusions')}
        hint={t('It will find patterns again and rebuild the weekly and monthly reviews. Records, objects and audio do not change. This uses tokens.')}
      >
        <div className={styles.inline}>
          <Button size="sm" variant="secondary" onClick={() => void ask()}>
            {t('Recalculate')}
          </Button>
        </div>
      </Row>
      <ConfirmSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t('Recalculate AI conclusions?')}
        message={unavailable ?? t('The app will send your records of the last weeks to the selected AI provider. See token usage in the “AI” group.')}
        confirmLabel={t('Recalculate')}
        disabled={unavailable !== null}
        onConfirm={async () => {
          try {
            const llm = createLlmProvider(await getSettings());
            const result = await recomputeDerived(llm);
            toast.show({
              message: result.error
                ? t('Not everything was recalculated: {error}', { error: result.error })
                : t('Done: patterns found {patternsCreated}, updated {patternsUpdated}, reviews rebuilt {reviews}', { patternsCreated: result.patternsCreated, patternsUpdated: result.patternsUpdated, reviews: result.reviews }),
              tone: result.error ? 'danger' : 'ok',
              duration: 6000,
            });
          } catch (cause) {
            toast.show({ message: describeError(cause), tone: 'danger' });
          }
        }}
      />
    </>
  );
}

function RawRow() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<RawCleanup | null>(null);

  return (
    <>
      <Row
        label={t('Delete raw material')}
        hint={t('Erases voice recordings and the original texts from before edits. Objects, final texts, people and reviews stay. Frees a lot of space.')}
      >
        <div className={styles.inline}>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              void countRawMaterial().then((found) => {
                setCounts(found);
                setOpen(true);
              })
            }
          >
            {t('Delete raw material')}
          </Button>
        </div>
      </Row>
      <TypedConfirm
        open={open}
        onClose={() => setOpen(false)}
        title={t('Delete audio and original texts?')}
        description={t('Will be erased: voice recordings {v}, original texts {v2}. Objects and final texts are kept. The audio cannot be restored afterwards.', { v: counts?.recordings ?? 0, v2: counts?.rawTexts ?? 0 })}
        confirmLabel={t('Delete raw material')}
        onConfirm={async () => {
          const done = await deleteRawMaterial();
          setOpen(false);
          toast.show({ message: t('Deleted audio: {recordings}, original texts: {rawTexts}', { recordings: done.recordings, rawTexts: done.rawTexts }), duration: 4000 });
        }}
      />
    </>
  );
}

function EraseRow() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Row label={t('Delete everything')} hint={t('All records, objects, people, settings and keys on this device. The app returns to its first-launch state.')}>
        <div className={styles.inline}>
          <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
            {t('Delete everything')}
          </Button>
        </div>
      </Row>
      <TypedConfirm
        open={open}
        onClose={() => setOpen(false)}
        title={t('Delete everything?')}
        description={t('This erases all Orbita data on this device with no way back. If you need a copy, export first.')}
        confirmLabel={t('Delete everything')}
        onConfirm={async () => {
          await eraseAll();
          setOpen(false);
          window.location.hash = '#/';
        }}
      />
    </>
  );
}

export function DataSection() {
  return (
    <Group id="data" title={t('Data')} footer={<p>{t("Data lives in the browser's storage on this device. A regular backup protects it if the phone is lost or the browser is cleared.")}</p>}>
      <ExportBlock />
      <ImportBlock />
      <TrashBlock />
      <DemoRow />
      <DerivedRow />
      <RawRow />
      <EraseRow />
    </Group>
  );
}
