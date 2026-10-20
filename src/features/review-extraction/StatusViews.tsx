import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { capturesRepo } from '../../db';
import type { Capture } from '../../domain/types';
import { processing } from '../../state';
import { Orb } from '../../ui/orb';
import { Body, Button, Caption, Display, EmptyState, Pill, TextArea, Thought } from '../../ui/primitives';
import type { PillTone } from '../../ui/primitives';
import type { ReviewView } from './model';
import styles from './Review.module.css';
import { t } from '../../i18n';

type WaitingView = Extract<ReviewView, { kind: 'waiting' }>;

const WAITING_PILL: Record<WaitingView['reason'], { label: string; tone: PillTone; title: string }> = {
  'no-key': { get label() { return t('No AI') }, tone: 'neutral', get title() { return t('Record saved') } },
  'no-transcript': { get label() { return t('Waiting for text') }, tone: 'neutral', get title() { return t('No words yet') } },
  offline: { get label() { return t('Waiting for the network') }, tone: 'warn', get title() { return t('Record saved') } },
  cancelled: { get label() { return t('Stopped') }, tone: 'neutral', get title() { return t('Processing stopped') } },
  idle: { get label() { return t('Waiting to be processed') }, tone: 'neutral', get title() { return t('Record saved') } },
};

/** The text of the capture, short, so it is clear what is waiting. */
function Snippet({ capture }: { capture: Capture }) {
  const text = capture.text.trim();
  if (text === '') return null;
  return (
    <blockquote className={styles.snippet}>
      <Thought size="sm">{text.length > 320 ? `${text.slice(0, 319).trimEnd()}…` : text}</Thought>
    </blockquote>
  );
}

/**
 * A saved capture that is not being processed: no key, no network, no text, or simply never started. Whatever the
 * reason, the record is safe, and the next step is one tap away.
 */
export function WaitingScreen({ capture, view }: { capture: Capture; view: WaitingView }) {
  const navigate = useNavigate();
  const info = WAITING_PILL[view.reason];
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const start = (manual: boolean): void => {
    void processing.enqueue(capture.id, { manual });
  };

  const saveTyped = async (): Promise<void> => {
    if (typed.trim() === '') return;
    setBusy(true);
    try {
      await capturesRepo.update(capture.id, { text: typed.trim(), rawText: capture.rawText ?? typed.trim(), status: 'transcribed' });
      start(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.center} aria-labelledby="waiting-title" data-testid="review-waiting" data-reason={view.reason}>
      <div className={styles.orb}>
        <Orb size={160} state="idle" />
      </div>
      <Pill tone={info.tone} dot live className={styles.pill}>
        {info.label}
      </Pill>
      <Display as="h2" size="l" id="waiting-title" className={styles.title}>
        {info.title}
      </Display>
      <Body tone="muted" className={styles.note}>
        {view.message}
      </Body>

      {view.reason === 'no-transcript' ? (
        <div className={styles.typed}>
          <TextArea
            aria-label={t('What was in the record')}
            placeholder={t('Write what the record was about, in your own words.')}
            rows={5}
            autoGrow
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <Button variant="primary" disabled={typed.trim() === ''} loading={busy} onClick={() => void saveTyped()}>
            {t('Save and process')}
          </Button>
          <Button variant="ghost" onClick={() => navigate('/settings')}>
            {t('Turn on speech recognition in settings')}
          </Button>
        </div>
      ) : (
        <div className={styles.actions}>
          {view.reason === 'no-key' ? (
            <>
              <Button variant="primary" iconStart="link" onClick={() => start(true)}>
                {t('Via clipboard')}
              </Button>
              <Button variant="secondary" onClick={() => navigate('/settings')}>
                {t('Add a key in settings')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" onClick={() => start(false)}>
                {view.reason === 'offline' ? t('Retry now') : t('Review', undefined, 'status-views')}
              </Button>
              <Button variant="secondary" iconStart="link" onClick={() => start(true)}>
                {t('Via clipboard')}
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => navigate('/today')}>
            {t('Later')}
          </Button>
        </div>
      )}
      <Snippet capture={capture} />
    </section>
  );
}

/** The model could not read the record (a bad key, a limit, a broken answer). The record is safe; «Повторить». */
export function FailedScreen({ capture, message }: { capture: Capture; message: string }) {
  const navigate = useNavigate();
  return (
    <section className={styles.center} aria-labelledby="failed-title" data-testid="review-failed">
      <div className={styles.orb}>
        <Orb size={160} state="error" />
      </div>
      <Pill tone="danger" dot live className={styles.pill}>
        {t('Could not process it')}
      </Pill>
      <Display as="h2" size="l" id="failed-title" className={styles.title}>
        {t('Record saved')}
      </Display>
      <Body tone="muted" className={styles.note} role="alert">
        {message}
      </Body>
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => void processing.enqueue(capture.id)}>
          {t('Try again')}
        </Button>
        <Button variant="secondary" iconStart="link" onClick={() => void processing.enqueue(capture.id, { manual: true })}>
          {t('Via clipboard')}
        </Button>
        <Button variant="ghost" onClick={() => navigate('/today')}>
          {t('Later')}
        </Button>
      </div>
      <Snippet capture={capture} />
    </section>
  );
}

export function MissingScreen() {
  const navigate = useNavigate();
  return (
    <EmptyState
      title={t('There is no such record.')}
      description={t('It may be in the trash, or the link is out of date.')}
      action={
        <Button variant="secondary" onClick={() => navigate('/stream')}>
          {t('To the stream')}
        </Button>
      }
    />
  );
}

export function SkippedScreen({ capture }: { capture: Capture }) {
  const navigate = useNavigate();
  return (
    <section className={styles.center} data-testid="review-skipped">
      <div className={styles.orb}>
        <Orb size={140} state="idle" />
      </div>
      <Display as="h2" size="l" className={styles.title}>
        {t('No speech found')}
      </Display>
      <Body tone="muted" className={styles.note}>
        {t('The record is silence or noise, there is nothing to process. The recording itself stays in the stream.')}
      </Body>
      <div className={styles.actions}>
        <Button variant="primary" onClick={() => navigate('/capture?autostart=1')}>
          {t('Record again')}
        </Button>
        <Button variant="ghost" onClick={() => navigate(`/entry/${capture.id}`)}>
          {t('Open the record')}
        </Button>
      </div>
      <Caption tone="faint">{t('If there was speech, turn on speech recognition in settings.')}</Caption>
    </section>
  );
}
