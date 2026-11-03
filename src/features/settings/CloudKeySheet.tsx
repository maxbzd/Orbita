import { useEffect, useState } from 'react';
import { answerJoin, beginJoin, cloudRecoveryText, completeJoin, enableCloudEncryption, joinWithRecoveryText } from '../../sync/e2eSetup';
import type { JoinRequest } from '@/crypto/pairing';
import { useCloud } from '../../sync';
import { Body, Button, Caption, Field, Sheet, useToast } from '../../ui';
import styles from './Settings.module.css';
import { t } from '../../i18n';

type View = 'home' | 'recovery' | 'add' | 'join';

function Code({ text }: { text: string }) {
  const toast = useToast();
  return (
    <div>
      <Body data-testid="code" className={styles.mono}>
        {text}
      </Body>
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
    </div>
  );
}

function Digits({ value }: { value: string }) {
  return (
    <div>
      <Caption>{t('Check digits')}</Caption>
      <Body data-testid="digits" className={styles.mono}>
        {value}
      </Body>
    </div>
  );
}

function Flow({ onClose }: { onClose(): void }) {
  const state = useCloud((s) => s.status);
  const locked = state === 'e2e-locked';
  const [on, setOn] = useState(false);
  const [view, setView] = useState<View>(locked ? 'join' : 'home');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState('');
  const [saved, setSaved] = useState(false);
  // add a device (the old device)
  const [theirCode, setTheirCode] = useState('');
  const [reading, setReading] = useState<{ checkDigits: string; answer(): Promise<string> } | null>(null);
  const [answer, setAnswer] = useState('');
  // join (the new device)
  const [request, setRequest] = useState<JoinRequest | null>(null);
  const [reply, setReply] = useState('');
  const [typedKey, setTypedKey] = useState('');

  useEffect(() => {
    void cloudRecoveryText().then((text) => setOn(text !== null));
  }, [view]);
  useEffect(() => {
    if (view === 'join' && !request) void beginJoin().then(setRequest);
  }, [view, request]);

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
  const failure = error ? (
    <Body role="alert" className={styles.resultBad}>
      {error}
    </Body>
  ) : null;

  if (view === 'recovery') {
    return (
      <div className={styles.sheetBody}>
        <Body tone="muted">{t('Write this key down or save it. With it, a new device can open your cloud data even if the old ones are gone.')}</Body>
        <Body data-testid="recovery-key" className={styles.mono}>
          {recovery}
        </Body>
        <label className={styles.inline}>
          <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
          <span>{t('I saved the recovery key')}</span>
        </label>
        <Button
          variant="primary"
          fullWidth
          disabled={!saved}
          onClick={() => {
            setRecovery('');
            setView('home');
          }}
        >
          {t('Done')}
        </Button>
      </div>
    );
  }

  if (view === 'add') {
    return (
      <div className={styles.sheetBody}>
        <Body tone="muted">{t('On the new device choose “Join”, and paste the code it shows here.')}</Body>
        <Field
          label={t('Code from the new device')}
          value={theirCode}
          spellCheck={false}
          onChange={(event) => {
            setTheirCode(event.target.value);
            setReading(null);
            setAnswer('');
          }}
        />
        {!reading ? (
          <Button variant="primary" fullWidth loading={busy} disabled={!theirCode.trim()} onClick={() => void run(async () => setReading(await answerJoin(theirCode)), t('That code is not valid'))}>
            {t('Continue')}
          </Button>
        ) : (
          <>
            <Digits value={reading.checkDigits} />
            <Body tone="muted">{t('The same 12 digits must be on the new device. If they differ, stop: someone changed the code on the way.')}</Body>
            {!answer ? (
              <Button variant="primary" fullWidth loading={busy} onClick={() => void run(async () => setAnswer(await reading.answer()), t("Couldn't make the answer"))}>
                {t('They match: make the answer')}
              </Button>
            ) : (
              <>
                <Body tone="muted">{t('Paste this answer on the new device.')}</Body>
                <Code text={answer} />
              </>
            )}
          </>
        )}
        {failure}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setView('home');
            setTheirCode('');
            setReading(null);
            setAnswer('');
            setError(null);
          }}
        >
          {t('Back')}
        </Button>
      </div>
    );
  }

  if (view === 'join') {
    return (
      <div className={styles.sheetBody}>
        <Body tone="muted">{t('Open Orbita on a device that already has your data, choose “Add a device”, and give it this code.')}</Body>
        {request ? (
          <>
            <Code text={request.code} />
            <Digits value={request.checkDigits} />
          </>
        ) : null}
        <Field label={t('Answer from the other device')} value={reply} spellCheck={false} onChange={(event) => setReply(event.target.value)} />
        <Button
          variant="primary"
          fullWidth
          loading={busy}
          disabled={!request || !reply.trim()}
          onClick={() =>
            void run(async () => {
              if (request) await completeJoin(request, reply);
              onClose();
            }, t("That answer doesn't open. Check that it is the one made for this code."))
          }
        >
          {t('Join')}
        </Button>
        <Caption>{t('Or use the recovery key')}</Caption>
        <Field label={t('Recovery key')} value={typedKey} spellCheck={false} placeholder="XXXXX-XXXXX-…" onChange={(event) => setTypedKey(event.target.value)} />
        <Button
          variant="secondary"
          fullWidth
          loading={busy}
          disabled={!typedKey.trim()}
          onClick={() =>
            void run(async () => {
              if (!(await joinWithRecoveryText(typedKey))) throw new Error(t('That is not a valid recovery key.'));
              onClose();
            }, t("Couldn't join"))
          }
        >
          {t('Join with the key')}
        </Button>
        {failure}
        {!locked ? (
          <Button variant="ghost" size="sm" onClick={() => setView('home')}>
            {t('Back')}
          </Button>
        ) : null}
      </div>
    );
  }

  // home
  return (
    <div className={styles.sheetBody}>
      {!on ? (
        <>
          <Body tone="muted">{t('Every record is sealed on your devices before it is sent. The server, and anyone who gets into it, sees only data it cannot read. Your devices still merge edits as before.')}</Body>
          <Body tone="muted">{t('The key stays on your devices. If you lose every device and the recovery key, the cloud copy cannot be read by anyone. Anything that reads your records on the server stops working, such as the connection to Claude.')}</Body>
          {failure}
          <Button
            variant="primary"
            fullWidth
            loading={busy}
            onClick={() =>
              void run(async () => {
                setRecovery(await enableCloudEncryption());
                setSaved(false);
                setView('recovery');
              }, t("Couldn't turn encryption on"))
            }
          >
            {busy ? t('Sealing your data…') : t('Turn on')}
          </Button>
        </>
      ) : (
        <>
          <Body tone="muted">{t('On: the server holds only sealed data.')}</Body>
          <Button variant="secondary" fullWidth onClick={() => setView('add')}>
            {t('Add a device')}
          </Button>
          <Button
            variant="secondary"
            fullWidth
            loading={busy}
            onClick={() =>
              void run(async () => {
                setRecovery((await cloudRecoveryText()) ?? '');
                setSaved(true);
                setView('recovery');
              }, t("Couldn't show the key"))
            }
          >
            {t('Show the recovery key')}
          </Button>
          <Body tone="muted">{t('Signing out of this device removes the key from it. To go back to plain cloud storage, delete the cloud data and sign in again.')}</Body>
          {failure}
        </>
      )}
    </div>
  );
}

/** Seal the cloud copy, and move the key between devices. */
export function CloudKeySheet({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Sheet open={open} onClose={onClose} title={t('Encrypt cloud data')} placement="sheet" snaps={[0.8]}>
      {open ? <Flow onClose={onClose} /> : null}
    </Sheet>
  );
}
