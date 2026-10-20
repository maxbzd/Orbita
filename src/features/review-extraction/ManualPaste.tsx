import { useState, useSyncExternalStore } from 'react';
import { manualBridge } from '../../ai';
import type { ID } from '../../domain/types';
import { processing } from '../../state';
import { Body, Button, Caption, TextArea, useToast } from '../../ui/primitives';
import { copyText, readClipboard } from './clipboard';
import styles from './Review.module.css';
import { t } from '../../i18n';

/** The request the clipboard provider is waiting on, live. */
export function useManualRequest() {
  return useSyncExternalStore(manualBridge.subscribe, () => manualBridge.getPending(), () => undefined);
}

/**
 * «Через буфер обмена» (SPEC §2.5): the app gives a ready prompt, the user takes it to any AI chat and pastes the
 * answer back. A bad paste does not fail anything: the problem is shown here, with a repair prompt, and the panel
 * waits for another try. The answer goes through exactly the same validation as an API answer.
 */
export function ManualPaste({ captureId }: { captureId: ID }) {
  const request = useManualRequest();
  const toast = useToast();
  const [answer, setAnswer] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  if (!request) {
    return (
      <div className={styles.manual} data-testid="manual-wait">
        <Body tone="muted">{t('Preparing a request for the AI chat.')}</Body>
      </div>
    );
  }

  const copy = async (text: string, done: string): Promise<void> => {
    toast.show({ message: (await copyText(text)) ? done : t('Could not copy. Select the text and copy it manually.'), duration: 3000 });
  };

  const submit = (): void => {
    const result = manualBridge.submitResponse(answer);
    if (result.ok) {
      setAnswer('');
      setProblem(null);
    } else {
      setProblem(result.error);
    }
  };

  const error = problem ?? request.lastError;

  return (
    <div className={styles.manual} data-testid="manual-paste">
      <ol className={styles.manualSteps}>
        <li>
          <Body>{t('Copy the request.')}</Body>
          <div className={styles.manualRow}>
            <Button variant="primary" size="md" iconStart="link" onClick={() => void copy(request.prompt, t('Request copied.'))}>
              {t('Copy the request')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowPrompt((value) => !value)} aria-expanded={showPrompt}>
              {showPrompt ? t('Hide text') : t('Show text')}
            </Button>
          </div>
          {showPrompt ? <textarea className={styles.prompt} readOnly value={request.prompt} aria-label={t('Request text')} rows={8} /> : null}
          <Caption tone="faint">{t('{v} characters. It goes only to the chat you paste it into.', { v: request.prompt.length.toLocaleString('ru-RU') })}</Caption>
        </li>
        <li>
          <Body>{t('Paste the request into Claude, ChatGPT or any other AI chat.')}</Body>
        </li>
        <li>
          <Body>{t('Paste the whole answer, it must be JSON.')}</Body>
          <TextArea
            aria-label={t("The AI's answer")}
            placeholder="{ … }"
            rows={5}
            value={answer}
            error={error}
            onChange={(event) => {
              setAnswer(event.target.value);
              setProblem(null);
            }}
          />
          <div className={styles.manualRow}>
            <Button variant="primary" size="md" disabled={answer.trim() === ''} onClick={submit}>
              {t('Paste the answer')}
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => void readClipboard().then((text) => (text ? setAnswer(text) : toast.show({ message: t('The browser did not allow reading the clipboard. Paste the answer by hand.'), duration: 4000 })))}
            >
              {t('From clipboard')}
            </Button>
          </div>
          {request.repairPrompt ? (
            <Button variant="ghost" size="sm" onClick={() => void copy(request.repairPrompt ?? '', t('Fix request copied.'))}>
              {t('Copy the fix request')}
            </Button>
          ) : null}
        </li>
      </ol>
      <Button variant="ghost" onClick={() => processing.cancel(captureId)}>
        {t('Cancel', undefined, 'manual-paste')}
      </Button>
    </div>
  );
}
