import { useState, useSyncExternalStore } from 'react';
import { manualBridge } from '../../ai';
import { Body, Button, Caption, TextArea, useToast } from '../../ui';
import { copyText } from '../context/clipboard';
import styles from './Ask.module.css';
import { t } from '../../i18n';

/**
 * «Через буфер обмена» for a question: the app prepares the whole prompt, the user takes it to any AI chat and pastes
 * the answer back. A bad paste is explained; the panel waits for another one.
 */
export function ManualPanel() {
  const request = useSyncExternalStore(manualBridge.subscribe, () => manualBridge.getPending(), () => undefined);
  const toast = useToast();
  const [answer, setAnswer] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  if (!request) return null;

  const copy = async (): Promise<void> => {
    toast.show({ message: (await copyText(request.prompt)) ? t('The request is copied. Paste it into an AI chat.') : t('Could not copy: select the text and copy it by hand.'), duration: 3000 });
  };
  const submit = (): void => {
    const result = manualBridge.submitResponse(answer);
    if (result.ok) {
      setAnswer('');
      setProblem(null);
    } else setProblem(result.error);
  };
  const error = problem ?? request.lastError;

  return (
    <section className={styles.manual} aria-label={t('Answer through the clipboard')}>
      <Body>{t('Step 1. Copy the request and send it to any AI chat (Claude, ChatGPT, Gemini).')}</Body>
      <div className={styles.row}>
        <Button size="sm" variant="secondary" onClick={() => void copy()}>
          {t('Copy the request')}
        </Button>
      </div>
      <Body>{t('Step 2. Paste the answer here.')}</Body>
      <TextArea label={t("The AI's answer")} value={answer} onChange={(event) => setAnswer(event.target.value)} rows={4} error={error ?? undefined} />
      <div className={styles.row}>
        <Button size="sm" variant="primary" onClick={submit} disabled={answer.trim() === ''}>
          {t('Done')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => manualBridge.cancelPending()}>
          {t('Cancel')}
        </Button>
      </div>
      <Caption tone="faint">{t('The request contains excerpts from your records: exactly what you paste into the chat goes there.')}</Caption>
    </section>
  );
}
