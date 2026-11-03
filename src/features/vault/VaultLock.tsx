import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Backdrop, Body, Button, Display, Field, Orb } from '../../ui';
import { TypedConfirm } from '../settings/TypedConfirm';
import { vault } from '../../vault';
import { passkeys } from '../../vault/keys';
import { PasskeyError, askVaultPasskey, passkeySupported } from '../../vault/passkey';
import { useVaultState } from '../../vault/state';
import styles from '../lock/Lock.module.css';
import { t } from '../../i18n';

type Way = 'password' | 'recovery';

/** The entrance to an encrypted Orbita: a password, a passkey, or the recovery key. There is no way around it. */
export default function VaultLock() {
  const busy = useVaultState((s) => s.busy);
  const [way, setWay] = useState<Way>('password');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [erase, setErase] = useState(false);
  const header = vault.header();
  const hasPasskey = !!header && passkeys(header).length > 0 && passkeySupported();

  useEffect(() => {
    if (wait <= 0) return undefined;
    const timer = window.setInterval(() => setWait(vault.secondsUntilRetry()), 500);
    return () => window.clearInterval(timer);
  }, [wait]);

  const explain = (result: Awaited<ReturnType<typeof vault.unlock>>): void => {
    if (result === 'wrong') setError(way === 'password' ? t('Wrong password.') : t('That recovery key does not match.'));
    else if (result === 'wait') setError(t('Too many attempts.'));
    else if (result === 'tab') setError(t('Orbita is open in another window. Close it and try again.'));
    else if (result === 'error') setError(t('The data could not be opened.'));
    setWait(vault.secondsUntilRetry());
  };

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || value === '' || wait > 0) return;
    setError(null);
    const result = await vault.unlock(way === 'password' ? { kind: 'password', password: value } : { kind: 'recovery', key: value });
    if (result !== 'ok') {
      explain(result);
      setValue('');
    }
  };

  const withPasskey = async (): Promise<void> => {
    setError(null);
    try {
      const { credentialId, secret } = await askVaultPasskey(header?.wraps ?? []);
      const result = await vault.unlock({ kind: 'passkey', credentialId, secret });
      if (result !== 'ok') explain(result);
    } catch (cause) {
      if (!(cause instanceof PasskeyError && cause.code === 'cancelled')) setError(t('The passkey did not work.'));
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
            {way === 'password' ? t('Enter your password to open your records.') : t('Enter the recovery key you saved when you turned protection on.')}
          </Body>
        </div>
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <Field
            label={way === 'password' ? t('Password') : t('Recovery key')}
            type="password"
            autoComplete={way === 'password' ? 'current-password' : 'off'}
            spellCheck={false}
            autoFocus
            value={value}
            error={error ?? undefined}
            placeholder={way === 'recovery' ? 'XXXXX-XXXXX-…' : undefined}
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
          {hasPasskey ? (
            <Button variant="secondary" fullWidth onClick={() => void withPasskey()}>
              {t('Use a passkey')}
            </Button>
          ) : null}
          <Button
            variant="ghost"
            fullWidth
            onClick={() => {
              setWay((w) => (w === 'password' ? 'recovery' : 'password'));
              setValue('');
              setError(null);
            }}
          >
            {way === 'password' ? t('I forgot the password') : t('Use the password instead')}
          </Button>
          <Button variant="ghost" fullWidth onClick={() => setErase(true)}>
            {t('I lost everything: start over')}
          </Button>
        </form>
      </main>
      <TypedConfirm
        open={erase}
        onClose={() => setErase(false)}
        title={t('Start over?')}
        description={t('This deletes all your records on this device for good. Only a backup file can bring them back.')}
        confirmLabel={t('Erase everything')}
        onConfirm={() => vault.eraseEverything()}
      />
    </>
  );
}
