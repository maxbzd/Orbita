import { useState } from 'react';
import { useSettings } from '../../db/hooks';
import { Body, Button, Caption, Field, SegmentedControl, Sheet, useToast } from '../../ui';
import { AUTO_LOCK_LABELS } from '../settings/settingsModel';
import { Group, Row } from '../settings/Group';
import styles from '../settings/Settings.module.css';
import { vault } from '../../vault';
import { passkeys } from '../../vault/keys';
import { PasskeyError, passkeySupported, registerPasskey } from '../../vault/passkey';
import type { PreparedVault } from '../../vault/session';
import { useVaultState } from '../../vault/state';
import { t } from '../../i18n';

type View = 'enable' | 'password' | 'newRecovery' | 'turnOff' | null;
const LOCK_CHOICES = [0, 1, 5, 15, 60] as const;
const MIN = 8;

function problemWith(password: string, repeat: string): string | null {
  if (password.length < MIN) return t('Use at least {n} characters.', { n: MIN });
  if (password !== repeat) return t('The two entries do not match.');
  return null;
}

function save(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The recovery key, shown once: the only way back in if the password is forgotten. */
function RecoveryKey({ text }: { text: string }) {
  const toast = useToast();
  return (
    <div>
      <Caption>{t('Your recovery key')}</Caption>
      <Body data-testid="recovery-key" className={styles.mono}>
        {text}
      </Body>
      <div className={styles.inline}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(text).catch(() => undefined);
            toast.show({ message: t('Copied'), duration: 2000 });
          }}
        >
          {t('Copy')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => save('orbita-recovery-key.txt', `${t('Orbita recovery key')}\n\n${text}\n\n${t('Keep this somewhere safe and private. Anyone who has it can open your data.')}\n`)}>
          {t('Save a file')}
        </Button>
      </div>
    </div>
  );
}

function Flow({ view, onDone }: { view: Exclude<View, null>; onDone(): void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [current, setCurrent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedVault | null>(null);
  const [recovery, setRecovery] = useState('');
  const [saved, setSaved] = useState(false);
  const [step, setStep] = useState<'form' | 'recovery'>('form');

  const run = async (action: () => Promise<void>, fallback: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : fallback);
    } finally {
      setBusy(false);
    }
  };
  const confirmed = async (): Promise<boolean> => {
    if (await vault.verifyPassword(current)) return true;
    setError(t('Wrong password.'));
    return false;
  };

  const submit = (): void => {
    if (view === 'enable') {
      const problem = problemWith(password, repeat);
      if (problem) return setError(problem);
      void run(async () => {
        const made = await vault.prepare(password);
        setPrepared(made);
        setRecovery(made.recoveryKey);
        setStep('recovery');
      }, t("Couldn't turn protection on. Nothing was changed."));
    } else if (view === 'password') {
      const problem = problemWith(password, repeat);
      if (problem) return setError(problem);
      void run(async () => {
        if (!(await confirmed())) return;
        await vault.changePassword(password);
        toast.show({ message: t('Password changed'), tone: 'ok', duration: 3000 });
        onDone();
      }, t("Couldn't change the password"));
    } else if (view === 'newRecovery') {
      void run(async () => {
        if (!(await confirmed())) return;
        setRecovery(await vault.renewRecoveryKey());
        setSaved(false);
        setStep('recovery');
      }, t("Couldn't make a new key"));
    } else {
      void run(async () => {
        if (!(await confirmed())) return;
        await vault.disable();
      }, t("Couldn't turn protection off"));
    }
  };

  if (step === 'recovery') {
    return (
      <div className={styles.sheetBody}>
        <Body tone="muted">{prepared ? t('Write this key down or save it. It is the only way back in if you forget the password. It is shown once.') : t('Your new recovery key. The old one no longer works.')}</Body>
        <RecoveryKey text={recovery} />
        <label className={styles.inline}>
          <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
          <span>{t('I saved the recovery key')}</span>
        </label>
        {error ? (
          <Body role="alert" className={styles.resultBad}>
            {error}
          </Body>
        ) : null}
        {prepared ? (
          <>
            <Button variant="primary" fullWidth disabled={!saved} loading={busy} onClick={() => void run(() => prepared.commit(), t("Couldn't finish. Close the other windows of Orbita and try again."))}>
              {t('Turn protection on')}
            </Button>
            <Button
              variant="ghost"
              fullWidth
              onClick={() => {
                void prepared.abort();
                onDone();
              }}
            >
              {t('Cancel', undefined, 'confirm-sheet')}
            </Button>
          </>
        ) : (
          <Button variant="primary" fullWidth disabled={!saved} onClick={onDone}>
            {t('Done')}
          </Button>
        )}
      </div>
    );
  }

  const needsCurrent = view !== 'enable';
  const needsNew = view === 'enable' || view === 'password';
  const label = { enable: t('Continue'), password: t('Change the password'), newRecovery: t('Make a new recovery key'), turnOff: t('Turn protection off') }[view];
  return (
    <form
      className={styles.sheetBody}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {view === 'enable' ? <Body tone="muted">{t('Everything is kept encrypted on this device. Without your password, a passkey or the recovery key, no one can read it, even with the phone in hand. Opening takes a moment, and the app locks itself when you leave it.')}</Body> : null}
      {view === 'enable' ? <Body tone="muted">{t('If you lose the password and the recovery key, your data cannot be recovered. Keep a backup file as well.')}</Body> : null}
      {view === 'newRecovery' ? <Body tone="muted">{t('The old recovery key stops working.')}</Body> : null}
      {view === 'turnOff' ? <Body tone="muted">{t('Your data will be stored on this device without encryption again.')}</Body> : null}
      {needsCurrent ? <Field label={t('Your current password')} type="password" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} /> : null}
      {needsNew ? (
        <>
          <Field label={view === 'enable' ? t('Choose a password') : t('New password')} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <Field label={t('Repeat')} type="password" autoComplete="new-password" value={repeat} onChange={(event) => setRepeat(event.target.value)} />
        </>
      ) : null}
      {error ? (
        <Body role="alert" className={styles.resultBad}>
          {error}
        </Body>
      ) : null}
      <Button type="submit" variant={view === 'turnOff' ? 'danger' : 'primary'} fullWidth loading={busy} disabled={needsCurrent && current === ''}>
        {busy && view === 'enable' ? t('Encrypting your data…') : label}
      </Button>
    </form>
  );
}

/** Encryption at rest: turn it on or off, and manage how the app is opened. */
export function VaultSection() {
  const state = useVaultState((s) => s.state);
  const settings = useSettings();
  const toast = useToast();
  const [view, setView] = useState<View>(null);
  const recoveryShown = view === 'enable';
  const [minutes, setMinutes] = useState(() => vault.autoLockMinutes());
  const [, bump] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const on = state === 'unlocked';
  const header = vault.header();
  const keys = header ? passkeys(header) : [];
  const lockOn = settings?.lock.enabled === true;

  const addPasskey = async (): Promise<void> => {
    setError(null);
    try {
      const made = await registerPasskey('Orbita');
      await vault.addPasskey(made.credentialId, made.prfSalt, made.secret, navigator.platform || t('This device'));
      bump((n) => n + 1);
      toast.show({ message: t('Passkey added'), tone: 'ok', duration: 3000 });
    } catch (cause) {
      if (!(cause instanceof PasskeyError && cause.code === 'cancelled')) setError(t("Couldn't add the passkey"));
    }
  };
  const titles = { enable: t('Protect this device'), password: t('Change the password'), newRecovery: t('Make a new recovery key'), turnOff: t('Turn protection off') } as const;

  return (
    <Group
      id="vault"
      title={t('Protect this device')}
      footer={
        <>
          <p>{on ? t('Protection is on. Only sealed data is stored on this device.') : t('Encrypt your records on this device.')}</p>
          <p>{t('Nothing readable is stored while it is on: the records are sealed with a key that only your password, a passkey or the recovery key can open.')}</p>
        </>
      }
    >
      {on ? (
        <>
          <Row label={t('Your data is encrypted on this device.')}>
            <div className={styles.inline}>
              <Button size="sm" variant="secondary" iconStart="lock" onClick={() => void vault.lock()}>
                {t('Lock now')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setView('password')}>
                {t('Change the password')}
              </Button>
            </div>
          </Row>
          <Row label={t('Lock automatically')} hint={t('Counts from the last tap, and from leaving the app.')}>
            <SegmentedControl<string>
              aria-label={t('Lock automatically')}
              options={LOCK_CHOICES.map((m) => ({ value: String(m), label: AUTO_LOCK_LABELS[m] ?? t('{minutes} min', { minutes: m }) }))}
              value={String(minutes)}
              onChange={(value) => {
                vault.setAutoLockMinutes(Number(value));
                setMinutes(Number(value));
              }}
              fullWidth
            />
          </Row>
          {passkeySupported() ? (
            <Row label={t('Passkeys')} hint={keys.length === 0 ? t('Open Orbita with Face ID, a fingerprint or a security key instead of typing the password.') : undefined}>
              {keys.map((key) => (
                <div key={key.credentialId} className={styles.inline}>
                  <Body>{key.label || t('Passkey')}</Body>
                  <Button size="sm" variant="ghost" onClick={() => void vault.removePasskey(key.credentialId as string).then(() => bump((n) => n + 1))}>
                    {t('Remove')}
                  </Button>
                </div>
              ))}
              <div className={styles.inline}>
                <Button size="sm" variant="secondary" onClick={() => void addPasskey()}>
                  {t('Add a passkey')}
                </Button>
              </div>
              {error ? (
                <Body role="alert" className={styles.resultBad}>
                  {error}
                </Body>
              ) : null}
            </Row>
          ) : null}
          <Row label={t('Recovery key')}>
            <div className={styles.inline}>
              <Button size="sm" variant="ghost" onClick={() => setView('newRecovery')}>
                {t('Make a new recovery key')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setView('turnOff')}>
                {t('Turn protection off')}
              </Button>
            </div>
          </Row>
        </>
      ) : (
        <Row label={t('Protection is off')} hint={lockOn ? t('The app lock is on. Turn it off first: this protection replaces it and covers the records too.') : t('Anyone who gets into this browser can read your records.')}>
          <div className={styles.inline}>
            <Button size="sm" variant="secondary" iconStart="lock" disabled={lockOn || state !== 'off'} onClick={() => setView('enable')}>
              {t('Set it up')}
            </Button>
          </div>
        </Row>
      )}
      <Sheet open={view !== null} onClose={() => setView(null)} title={view ? titles[view] : ''} placement="sheet" snaps={[0.8]} dismissible={view === null || !recoveryShown}>
        {view ? <Flow key={view} view={view} onDone={() => setView(null)} /> : null}
      </Sheet>
    </Group>
  );
}
