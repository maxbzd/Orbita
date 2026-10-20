import { useState } from 'react';
import type { FormEvent } from 'react';
import { formatDayShort, formatTime, localDayKey } from '../../domain/dates';
import { resolveAccountConflict, sendPasswordReset, setNewPassword, signIn, signOut, signUp, syncNow, useCloud, wipeCloud } from '../../sync';
import type { CloudState } from '../../sync';
import { Body, Button, Field, SegmentedControl, useToast } from '../../ui';
import { ConfirmSheet } from './ConfirmSheet';
import { Group, Row } from './Group';
import styles from './Settings.module.css';
import { t } from '../../i18n';

type Mode = 'in' | 'up';

const MIN_PASSWORD = 6;

function statusLine(state: CloudState): string {
  switch (state.status) {
    case 'syncing':
      return t('Syncing…');
    case 'offline':
      return t('No connection. Everything is saved on the device and will go to the cloud as soon as the network is back.');
    case 'error':
      return state.error ?? t('Could not sync. I will try again.');
    case 'account-conflict':
      return t("This device holds another account's data.");
    default:
      break;
  }
  if (state.lastSyncAt === null) return t('Not synced yet.');
  const at = new Date(state.lastSyncAt).toISOString();
  const today = localDayKey(new Date()) === localDayKey(at);
  return t('Synced {v}, {formatTime}.', { v: today ? t('today') : formatDayShort(localDayKey(at)), formatTime: formatTime(at) });
}

function reportLine(state: CloudState): string | null {
  const report = state.lastReport;
  if (!report) return null;
  const parts: string[] = [];
  if (report.applied > 0) parts.push(t('received: {applied}', { applied: report.applied }));
  if (report.pushed > 0) parts.push(t('sent: {pushed}', { pushed: report.pushed }));
  if (report.audioUp + report.audioDown > 0) parts.push(t('audio: {v}', { v: report.audioUp + report.audioDown }));
  if (report.rejected > 0) parts.push(t('skipped because of a newer version: {rejected}', { rejected: report.rejected }));
  return parts.length > 0 ? t('Last time: {v}.', { v: parts.join(', ') }) : null;
}

/** The sign-in / sign-up form; also used by the onboarding («У меня уже есть аккаунт»). */
export function CloudSignInForm() {
  const [mode, setMode] = useState<Mode>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t('Check the email address.'));
    if (password.length < MIN_PASSWORD) return setError(t('The password is shorter than {MIN_PASSWORD} characters.', { MIN_PASSWORD }));
    setBusy(true);
    try {
      if (mode === 'up') {
        const result = await signUp(email, password);
        if (result === 'confirm-email') {
          setNotice(t('A message was sent to {v}. Open it, confirm your email and come back here: sign in with the same password.', { v: email.trim() }));
          setMode('in');
        }
      } else {
        await signIn(email, password);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('That did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const reset = async (): Promise<void> => {
    setError(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError(t('Enter your email above: a link for a new password will be sent there.'));
    setBusy(true);
    try {
      await sendPasswordReset(email);
      setNotice(t('A link for a new password was sent to {v}.', { v: email.trim() }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('That did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <SegmentedControl<Mode>
        aria-label={t('Sign in or sign up')}
        options={[
          { value: 'in', label: t('Sign in') },
          { value: 'up', label: t('Create an account') },
        ]}
        value={mode}
        onChange={(value) => {
          setMode(value);
          setError(null);
        }}
        fullWidth
      />
      <Field label={t('Email')} type="email" autoComplete="email" inputMode="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
      <Field
        label={t('Password')}
        type="password"
        autoComplete={mode === 'up' ? 'new-password' : 'current-password'}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        hint={mode === 'up' ? t('At least {MIN_PASSWORD} characters. A forgotten password can be reset by email.', { MIN_PASSWORD }) : undefined}
      />
      {error ? (
        <Body role="alert" className={styles.resultBad}>
          {error}
        </Body>
      ) : null}
      {notice ? <Body role="status">{notice}</Body> : null}
      <Button type="submit" variant="primary" fullWidth loading={busy}>
        {mode === 'up' ? t('Create an account') : t('Sign in')}
      </Button>
      {mode === 'in' ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => void reset()} disabled={busy}>
          {t('Forgot your password?')}
        </Button>
      ) : null}
    </form>
  );
}

function NewPassword() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(t('The password is shorter than {MIN_PASSWORD} characters.', { MIN_PASSWORD }));
    setBusy(true);
    try {
      await setNewPassword(password);
      toast.show({ message: t('New password saved.'), tone: 'ok', duration: 3000 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('That did not work. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      <Body>{t('You opened a password reset link. Choose a new password.')}</Body>
      <Field label={t('New password')} type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      {error ? (
        <Body role="alert" className={styles.resultBad}>
          {error}
        </Body>
      ) : null}
      <Button type="submit" variant="primary" fullWidth loading={busy}>
        {t('Save the password')}
      </Button>
    </form>
  );
}

function Conflict() {
  const [busy, setBusy] = useState(false);
  const run = async (mode: 'merge' | 'replace'): Promise<void> => {
    setBusy(true);
    try {
      await resolveAccountConflict(mode);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.form}>
      <Body>
        {t("This device used to be linked to another account. You can add its data to this account or start clean: then the device's records are removed and whatever is in this account arrives from the cloud. Settings and keys stay.")}
      </Body>
      <Button variant="primary" fullWidth loading={busy} onClick={() => void run('replace')}>
        {t('Clear the device and take data from the cloud')}
      </Button>
      <Button variant="secondary" fullWidth disabled={busy} onClick={() => void run('merge')}>
        {t("Merge: add the device's data to this account")}
      </Button>
    </div>
  );
}

function SignedIn({ state }: { state: CloudState }) {
  const toast = useToast();
  const [confirmOut, setConfirmOut] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const busy = state.status === 'syncing';
  const detail = reportLine(state);

  const fail = (cause: unknown): void => {
    toast.show({ message: cause instanceof Error ? cause.message : t('That did not work.'), tone: 'danger', duration: 5000 });
  };

  return (
    <>
      <Row label={state.email ?? t('Account')} hint={statusLine(state)}>
        <div className={styles.inline}>
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void syncNow({ push: true })}>
            {t('Sync')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmOut(true)}>
            {t('Sign out')}
          </Button>
        </div>
        {detail ? <Body tone="muted">{detail}</Body> : null}
      </Row>
      <Row label={t('Delete data from the cloud')} hint={t('Erases everything this account keeps in the cloud and signs out. Records stay on your devices.')}>
        <div className={styles.inline}>
          <Button size="sm" variant="danger" onClick={() => setConfirmWipe(true)}>
            {t('Delete from the cloud')}
          </Button>
        </div>
      </Row>
      <ConfirmSheet
        open={confirmOut}
        onClose={() => setConfirmOut(false)}
        title={t('Sign out of the cloud?')}
        message={t('Data stays on this device and in the cloud. Sync stops until you sign in again.')}
        confirmLabel={t('Sign out')}
        onConfirm={() => signOut().catch(fail)}
      />
      <ConfirmSheet
        open={confirmWipe}
        onClose={() => setConfirmWipe(false)}
        title={t('Delete data from the cloud?')}
        message={t('Records, objects, people and audio will disappear from the cloud for all your devices. Everything stays on this device, but other devices will no longer receive changes. This cannot be undone.')}
        confirmLabel={t('Delete from the cloud')}
        onConfirm={() => wipeCloud().catch(fail)}
      />
    </>
  );
}

export function CloudSection() {
  const state = useCloud();
  const signedIn = state.userId !== null && state.status !== 'signed-out' && state.status !== 'starting';

  let body;
  if (state.needsNewPassword && state.userId) body = <NewPassword />;
  else if (state.status === 'account-conflict') body = <Conflict />;
  else if (signedIn) body = <SignedIn state={state} />;
  else if (state.status === 'starting') body = <Body tone="muted">{t('Checking sign-in…')}</Body>;
  else body = <CloudSignInForm />;

  return (
    <Group
      id="cloud"
      title={t('Cloud')}
      footer={
        <>
          <p>{t('Records, objects, people, projects, states, patterns, reviews, the profile and audio are copied to your cloud and appear on all devices where you are signed in to this account. Offline, everything works as before.')}</p>
          <p>{t('AI keys, the lock and settings stay on the device. Cloud data is protected by your password and access rules, but not encrypted with your key: do not reuse a password from other places.')}</p>
        </>
      }
    >
      {body}
    </Group>
  );
}
