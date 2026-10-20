import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSettings } from '../../db/hooks';
import type { LockKind } from '../../domain/types';
import { Body, Button, Caption, Field, SegmentedControl, Sheet, useToast } from '../../ui';
import { AUTO_LOCK_CHOICES, LockError, changePassword, disableLock, enableLock, lockNow, setAutoLockMinutes, validateNewPassword } from '../lock';
import { Group, Row } from './Group';
import { AUTO_LOCK_LABELS } from './settingsModel';
import styles from './Settings.module.css';
import { t } from '../../i18n';

const KIND_OPTIONS = [
  { value: 'password' as const, get label() { return t('Password') } },
  { value: 'pin' as const, label: 'PIN' },
];

type Mode = 'enable' | 'change' | 'disable' | null;

function messageOf(error: unknown): string {
  if (error instanceof LockError) return error.message;
  return error instanceof Error ? error.message : t('That did not work. Try again.');
}

/** Turn the lock on, change the password, turn it off. */
function LockForm({ mode, kind: currentKind, onDone }: { mode: Exclude<Mode, null>; kind: LockKind; onDone(): void }) {
  const toast = useToast();
  const [kind, setKind] = useState<LockKind>(currentKind);
  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [autoLock, setAutoLock] = useState<number>(5);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsOld = mode !== 'enable';
  const needsNew = mode !== 'disable';
  const label = kind === 'pin' ? 'PIN' : t('password');

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (needsNew) {
      const problem = validateNewPassword(kind, password, repeat);
      if (problem) return setError(problem);
    }
    setBusy(true);
    try {
      if (mode === 'enable') await enableLock(password, { kind, autoLockMinutes: autoLock });
      else if (mode === 'change') await changePassword(oldPassword, password, kind);
      else await disableLock(oldPassword);
      toast.show({ message: mode === 'enable' ? t('Lock enabled') : mode === 'change' ? t('Password changed') : t('Lock disabled'), tone: 'ok', duration: 3000 });
      onDone();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.sheetBody} onSubmit={(event) => void submit(event)}>
      {mode === 'enable' ? (
        <Body tone="muted">
          
          {t('The app will ask for {label} on every launch and after idling. A forgotten {label2} cannot be recovered: it is stored nowhere.', { label, label2: label })}
        
        </Body>
      ) : null}
      {needsNew ? (
        <SegmentedControl<LockKind> aria-label={t('Lock with')} options={KIND_OPTIONS} value={kind} onChange={setKind} fullWidth />
      ) : null}
      {needsOld ? (
        <Field
          label={kind === 'pin' || currentKind === 'pin' ? t('Current PIN') : t('Current password')}
          type="password"
          autoComplete="current-password"
          value={oldPassword}
          onChange={(event) => setOldPassword(event.target.value)}
        />
      ) : null}
      {needsNew ? (
        <>
          <Field
            label={kind === 'pin' ? t('New PIN') : t('New password')}
            type="password"
            inputMode={kind === 'pin' ? 'numeric' : 'text'}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint={kind === 'pin' ? t('At least 4 digits.') : t('At least 6 characters. A phrase of several words is better.')}
          />
          <Field
            label={t('Repeat')}
            type="password"
            inputMode={kind === 'pin' ? 'numeric' : 'text'}
            autoComplete="new-password"
            value={repeat}
            onChange={(event) => setRepeat(event.target.value)}
          />
        </>
      ) : null}
      {mode === 'enable' ? (
        <div>
          <Caption>{t('Lock after idling')}</Caption>
          <SegmentedControl<string>
            aria-label={t('Lock after idling')}
            options={AUTO_LOCK_CHOICES.map((minutes) => ({ value: String(minutes), label: AUTO_LOCK_LABELS[minutes] ?? t('{minutes} min', { minutes }) }))}
            value={String(autoLock)}
            onChange={(value) => setAutoLock(Number(value))}
            fullWidth
          />
        </div>
      ) : null}
      {error ? (
        <Body role="alert" className={styles.resultBad}>
          {error}
        </Body>
      ) : null}
      <Button type="submit" variant={mode === 'disable' ? 'danger' : 'primary'} fullWidth loading={busy}>
        {mode === 'enable' ? t('Enable lock') : mode === 'change' ? t('Change') : t('Disable lock')}
      </Button>
    </form>
  );
}

export function LockSection() {
  const settings = useSettings();
  const [mode, setMode] = useState<Mode>(null);
  if (!settings) return null;
  const { lock } = settings;
  const titles = { enable: t('Enable lock'), change: t('Change password'), disable: t('Disable lock') } as const;

  return (
    <Group
      id="lock"
      title={t('Lock')}
      footer={
        <>
          <p>{t("The password locks the app's entrance and encrypts your API keys. It is stored nowhere, only a verification fingerprint.")}</p>
          <p>{t('The records themselves are not encrypted on the device. To carry data safely, make an encrypted copy in the “Data” group.')}</p>
        </>
      }
    >
      {lock.enabled ? (
        <>
          <Row label={t('Enabled: {v}', { v: lock.kind === 'pin' ? 'PIN' : t('password') })}>
            <div className={styles.inline}>
              <Button size="sm" variant="secondary" onClick={() => lockNow()}>
                {t('Lock now')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode('change')}>
                {t('Change')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode('disable')}>
                {t('Disable')}
              </Button>
            </div>
          </Row>
          <Row label={t('Lock after idling')}>
            <SegmentedControl<string>
              aria-label={t('Lock after idling')}
              options={AUTO_LOCK_CHOICES.map((minutes) => ({ value: String(minutes), label: AUTO_LOCK_LABELS[minutes] ?? t('{minutes} min', { minutes }) }))}
              value={String(AUTO_LOCK_CHOICES.includes(lock.autoLockMinutes as never) ? lock.autoLockMinutes : 5)}
              onChange={(value) => void setAutoLockMinutes(Number(value))}
              fullWidth
            />
          </Row>
        </>
      ) : (
        <Row label={t('Lock disabled')} hint={t('Anyone who opens the app on this device will see your records.')}>
          <div className={styles.inline}>
            <Button size="sm" variant="secondary" iconStart="lock" onClick={() => setMode('enable')}>
              {t('Enable lock')}
            </Button>
          </div>
        </Row>
      )}
      <Sheet open={mode !== null} onClose={() => setMode(null)} title={mode ? titles[mode] : ''} placement="sheet" snaps={[0.7]}>
        {mode ? <LockForm key={mode} mode={mode} kind={lock.kind} onDone={() => setMode(null)} /> : null}
      </Sheet>
    </Group>
  );
}
