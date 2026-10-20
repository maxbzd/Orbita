import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { getStoredSettings } from '../../db';
import type { LockKind } from '../../domain/types';
import { Backdrop, Body, Button, Display, Field, Orb } from '../../ui';
import { TypedConfirm } from '../settings/TypedConfirm';
import { eraseEverythingAndUnlock, secondsUntilRetry, unlock } from './lockService';
import styles from './Lock.module.css';
import { t } from '../../i18n';

/** Full-screen password (or PIN) entry. There is no way around it except the password or erasing the data. */
export function LockScreen() {
  const [kind, setKind] = useState<LockKind>('password');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getStoredSettings().then((settings) => {
      if (!cancelled) setKind(settings.lock.kind);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The countdown after wrong attempts.
  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = window.setInterval(() => setWait(secondsUntilRetry()), 500);
    return () => window.clearInterval(timer);
  }, [wait]);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || value === '' || wait > 0) return;
    setBusy(true);
    try {
      const result = await unlock(value);
      if (result === 'ok') return;
      setError(result === 'wrong' ? (kind === 'pin' ? t('Wrong PIN.') : t('Wrong password.')) : t('Too many attempts.'));
      setValue('');
      setWait(secondsUntilRetry());
      input.current?.focus();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('Could not check the password.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Backdrop auraIntensity={0.35} grain={false} twinkle={false} />
      <main className={styles.screen} aria-labelledby="lock-title">
        <div className={styles.hero}>
          <Orb state="idle" size={140} />
          <Display as="h1" size="l" id="lock-title">
            {t('Orbita is locked')}
          </Display>
          <Body tone="muted" className={styles.lead}>
            {kind === 'pin' ? t('Enter your PIN to open your records.') : t('Enter your password to open your records.')}
          </Body>
        </div>
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <Field
            ref={input}
            label={kind === 'pin' ? 'PIN' : t('Password')}
            type="password"
            inputMode={kind === 'pin' ? 'numeric' : 'text'}
            autoComplete="current-password"
            autoFocus
            value={value}
            error={error ?? undefined}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
          />
          {wait > 0 ? (
            <Body tone="muted" role="status" className={styles.wait}>
              
              {t('Wait {wait} s and try again.', { wait })}
            
            </Body>
          ) : null}
          <Button type="submit" variant="primary" fullWidth loading={busy} disabled={value === '' || wait > 0}>
            {t('Open', undefined, 'lock-screen')}
          </Button>
          <Button variant="ghost" fullWidth onClick={() => setForgot(true)}>
            
            {t('Forgot your {v}?', { v: kind === 'pin' ? 'PIN' : t('password') })}
          
          </Button>
        </form>
      </main>
      <TypedConfirm
        open={forgot}
        onClose={() => setForgot(false)}
        title={t('Forgot your password?')}
        description={t('A password cannot be recovered: it is not stored anywhere. You can erase all data on this device and start over. If you have a backup, you can load it back afterwards.')}
        confirmLabel={t('Erase everything')}
        onConfirm={eraseEverythingAndUnlock}
      />
    </>
  );
}
