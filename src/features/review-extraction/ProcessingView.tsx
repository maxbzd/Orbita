import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Capture } from '../../domain/types';
import type { Job } from '../../state';
import { Orb } from '../../ui/orb';
import { Body, Button, Caption, Display, Pill } from '../../ui/primitives';
import { ManualPaste, useManualRequest } from './ManualPaste';
import type { ProcessingStage } from './model';
import styles from './Review.module.css';
import { t } from '../../i18n';

/** Past this long the screen says it is still working and that leaving is fine (§2.11 «ЕЩЁ ДУМАЮ»). */
export const LONG_WAIT_MS = 15_000;

const STAGE_LABEL: Record<ProcessingStage, string> = {
  get saving() { return t('Saving') },
  get queued() { return t('Starting') },
  get transcribing() { return t('Transcribing…') },
  get extracting() { return t('Structuring…') },
};

export interface Step {
  id: string;
  label: string;
  state: 'done' | 'active' | 'todo';
}

/**
 * The honest list of steps: only those that really exist for this capture (a recording is transcribed, a typed note
 * is not), each marked by what the pipeline reports. No percentages, no invented work.
 */
export function stepsFor(stage: ProcessingStage, hasAudio: boolean, hasText: boolean): Step[] {
  const order: ProcessingStage[] = hasAudio && !hasText ? ['saving', 'transcribing', 'extracting'] : ['saving', 'extracting'];
  const at = order.indexOf(stage === 'queued' ? (hasAudio && !hasText ? 'transcribing' : 'extracting') : stage);
  const labels: Record<string, string> = { saving: t('Record saved'), transcribing: t('Transcribing'), extracting: t('Structuring') };
  const steps: Step[] = order.map((id, index) => ({
    id,
    label: labels[id] ?? id,
    state: index < at ? 'done' : index === at ? 'active' : 'todo',
  }));
  // The save is over as soon as the capture exists.
  if (stage !== 'saving' && steps[0]) steps[0].state = 'done';
  return steps;
}

function useElapsedMs(startedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return startedAt === undefined ? 0 : Math.max(0, now - startedAt);
}

export interface ProcessingViewProps {
  capture: Capture;
  job: Job | undefined;
  stage: ProcessingStage;
  manual: boolean;
}

/** The torus, the step log, and the way out: processing continues in the background whatever the user does. */
export function ProcessingView({ capture, job, stage, manual }: ProcessingViewProps) {
  const navigate = useNavigate();
  const request = useManualRequest();
  const elapsed = useElapsedMs(job?.startedAt);
  const long = elapsed >= LONG_WAIT_MS;
  const steps = stepsFor(stage, capture.audioId !== undefined, capture.text.trim() !== '');
  const waitingForPaste = manual && request !== undefined;

  return (
    <section className={styles.center} aria-labelledby="processing-title" data-testid="review-processing">
      <div className={styles.orb}>
        <Orb size={manual ? 120 : 200} state="thinking" />
      </div>
      <Pill tone="ai" dot live className={styles.pill}>
        {waitingForPaste ? t('Waiting for a reply') : long ? t('Still thinking') : STAGE_LABEL[stage]}
      </Pill>
      <Display as="h2" size="l" id="processing-title" className={styles.title}>
        {waitingForPaste ? t("The AI chat's answer is needed") : t('Processing the record')}
      </Display>

      {waitingForPaste ? (
        <ManualPaste captureId={capture.id} />
      ) : (
        <>
          <ol className={styles.steps} aria-live="polite" aria-label={t('Processing steps')}>
            {steps.map((step) => (
              <li key={step.id} data-state={step.state}>
                <span className={styles.stepMark} aria-hidden="true" />
                {step.label}
              </li>
            ))}
          </ol>
          {long ? (
            <>
              <Body tone="muted" className={styles.note}>
                {t('You can close this, I will continue in the background. The record is already saved.')}
              </Body>
              <Button variant="secondary" onClick={() => navigate('/today')}>
                {t('Close')}
              </Button>
            </>
          ) : (
            <Caption className={styles.note}>{t('The record is already saved. You can leave: I will finish in the background.')}</Caption>
          )}
        </>
      )}
    </section>
  );
}
