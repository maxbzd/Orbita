import { useMemo, useState } from 'react';
import { itemsRepo } from '../../db';
import { DECISION_RATINGS, IDEA_STAGES } from '../../domain/types';
import type { DecisionRating, ID, Item, ItemOfKind, PredictionOutcome } from '../../domain/types';
import { Button, Caption, Chip, Field, Heading, Label, TextArea, cx, useToast } from '../../ui';
import { clearDuplicate, findDuplicateCandidates, ideaToTask, mergeIdea, setIdeaStage, supersedeFact } from './actions';
import { RATING_LABELS, STAGE_LABELS } from './model';
import styles from './KindPanels.module.css';
import { t } from '../../i18n';

/** The forms that are particular to a kind: closing a forecast, reviewing a decision, an idea's life, an answer, a changed fact. */

function useGuard() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      toast.show({ message: error instanceof Error ? error.message : t('Could not save.'), tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  return { busy, run, toast };
}

// ───────── Prediction ─────────

const OUTCOMES: ReadonlyArray<{ value: PredictionOutcome; label: string; done: string }> = [
  { value: 'true', get label() { return t('Came true') }, get done() { return t('Recorded: it came true.') } },
  { value: 'false', get label() { return t('Did not come true') }, get done() { return t('Recorded: it did not come true.') } },
  { value: 'unknown', get label() { return t('Unknown') }, get done() { return t('Closed without a rating: “unknown” does not count in calibration.') } },
];

export function PredictionPanel({ item, due }: { item: ItemOfKind<'prediction'>; due: boolean }) {
  const { busy, run, toast } = useGuard();
  const [note, setNote] = useState('');
  if (item.status !== 'active' || item.outcome) return null;
  const close = (outcome: PredictionOutcome, done: string) =>
    run(async () => {
      await itemsRepo.resolvePrediction(item.id, outcome, note.trim() || undefined);
      toast.show({ message: done, actionLabel: t('Restore'), onAction: () => void itemsRepo.reopen(item.id) });
    });
  return (
    <section className={cx(styles.panel, due && styles.due)} aria-label={t('Close the prediction')}>
      <Heading variant="headline">{due ? t('Time to find out how it ended') : t('How did it end?')}</Heading>
      <Caption>{t('You said {round} %. Close it once it is known and your calibration will be recalculated.', { round: Math.round(item.probability * 100) })}</Caption>
      <TextArea label={t('Note (optional)')} value={note} onChange={(event) => setNote(event.target.value)} rows={2} autoGrow />
      <div className={styles.buttons}>
        {OUTCOMES.map((outcome) => (
          <Button key={outcome.value} variant={outcome.value === 'unknown' ? 'ghost' : 'secondary'} size="md" disabled={busy} onClick={() => void close(outcome.value, outcome.done)}>
            {outcome.label}
          </Button>
        ))}
      </div>
    </section>
  );
}

// ───────── Decision ─────────

export function DecisionPanel({ item, due }: { item: ItemOfKind<'decision'>; due: boolean }) {
  const { busy, run, toast } = useGuard();
  const [rating, setRating] = useState<DecisionRating | null>(null);
  const [note, setNote] = useState('');
  if (item.status !== 'active' || item.outcome) return null;
  const save = () =>
    run(async () => {
      if (rating === null) return;
      await itemsRepo.closeDecision(item.id, { rating, note: note.trim() });
      toast.show({ message: t('Outcome recorded.'), actionLabel: t('Restore'), onAction: () => void itemsRepo.reopen(item.id) });
    });
  return (
    <section className={cx(styles.panel, due && styles.due)} aria-label={t('Decision review')}>
      <Heading variant="headline">{t('How did it turn out?')}</Heading>
      <Caption>{t('{v}Rate how well the decision paid off and write down what you learned.', { v: due ? t('It is time to review. ') : '' })}</Caption>
      <div className={styles.ratings} role="radiogroup" aria-label={t('Outcome rating from 1 to 5')}>
        {DECISION_RATINGS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={rating === value}
            aria-label={t('{value} of 5: {v}', { value, v: RATING_LABELS[value] })}
            className={cx(styles.rating, rating === value && styles.ratingOn)}
            onClick={() => setRating(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <Caption className={styles.ratingWord} aria-live="polite">
        {rating === null ? t('Pick from 1 to 5') : RATING_LABELS[rating]}
      </Caption>
      <TextArea label={t('Note')} value={note} onChange={(event) => setNote(event.target.value)} rows={2} autoGrow placeholder={t('What happened, what you would do differently')} />
      <Button variant="primary" size="md" disabled={busy || rating === null} onClick={() => void save()}>
        {t('Record the outcome')}
      </Button>
    </section>
  );
}

// ───────── Idea ─────────

export function IdeaPanel({
  item,
  ideas,
  onOpen,
}: {
  item: ItemOfKind<'idea'>;
  ideas: readonly Item[];
  onOpen(id: ID, kind: 'task'): void;
}) {
  const { busy, run, toast } = useGuard();
  const candidates = useMemo(() => findDuplicateCandidates(item, ideas), [item, ideas]);
  const suspected = item.duplicateOf ? ideas.find((idea) => idea.id === item.duplicateOf && idea.status !== 'dismissed') : undefined;
  const closed = item.status === 'done' || item.status === 'dropped';

  const merge = (sourceId: ID, targetId: ID) =>
    run(async () => {
      const undo = await mergeIdea(sourceId, targetId);
      toast.show({ message: t('Ideas merged.'), actionLabel: t('Restore'), onAction: () => void undo() });
    });

  return (
    <section className={styles.panel} aria-label={t('Idea')}>
      <Heading variant="headline">{t('What to do with this idea')}</Heading>
      <div className={styles.chips} role="group" aria-label={t('Stage')}>
        {IDEA_STAGES.map((stage) => (
          <Chip key={stage} selected={item.stage === stage} onClick={() => void run(async () => void (await setIdeaStage(item, stage)))}>
            {STAGE_LABELS[stage]}
          </Chip>
        ))}
      </div>
      {!closed ? (
        <Button
          variant="secondary"
          size="md"
          iconStart="task"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const task = await ideaToTask(item);
              toast.show({ message: t('Task created.'), actionLabel: t('Open', undefined, 'kind-panels'), onAction: () => onOpen(task.id, 'task') });
            })
          }
        >
          {t('Make it a task')}
        </Button>
      ) : null}

      {suspected ? (
        <div className={styles.callout} role="group" aria-label={t('Possible duplicate')}>
          <Caption>{t('This may be a duplicate of the idea “{title}”.', { title: suspected.title })}</Caption>
          <div className={styles.buttons}>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => void merge(item.id, suspected.id)}>
              {t('Merge into it')}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(async () => void (await clearDuplicate(item.id)))}>
              {t('Not a duplicate')}
            </Button>
          </div>
        </div>
      ) : null}

      {candidates.length > 0 && !closed ? (
        <div className={styles.group}>
          <Label>{t('Similar ideas')}</Label>
          <ul className={styles.candidates}>
            {candidates.map(({ item: other, score }) => (
              <li key={other.id} className={styles.candidate}>
                <span className={styles.candidateText}>
                  <span className={styles.candidateTitle}>{other.title}</span>
                  <Caption>{t('{round} % similar', { round: Math.round(score * 100) })}</Caption>
                </span>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void merge(other.id, item.id)} aria-label={t('Merge into this idea: {title}', { title: other.title })}>
                  {t('Merge here')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ───────── Question ─────────

export function QuestionPanel({ item }: { item: ItemOfKind<'question'> }) {
  const { busy, run, toast } = useGuard();
  const [answer, setAnswer] = useState('');
  if (item.status !== 'active' || item.answer?.trim()) return null;
  return (
    <section className={styles.panel} aria-label={t('Answer the question')}>
      <Heading variant="headline">{t('Found the answer?')}</Heading>
      <TextArea label={t('Answer')} value={answer} onChange={(event) => setAnswer(event.target.value)} rows={2} autoGrow />
      <Button
        variant="primary"
        size="md"
        disabled={busy || answer.trim() === ''}
        onClick={() =>
          void run(async () => {
            await itemsRepo.update(item.id, { answer: answer.trim(), status: 'done' });
            toast.show({ message: t('Answer recorded.'), actionLabel: t('Restore'), onAction: () => void itemsRepo.update(item.id, { answer: undefined, status: 'active' }) });
          })
        }
      >
        {t('Answer', undefined, 'kind-panels')}
      </Button>
    </section>
  );
}

// ───────── Fact ─────────

export function FactPanel({ item }: { item: ItemOfKind<'fact'> }) {
  const { busy, run, toast } = useGuard();
  const [value, setValue] = useState('');
  if (item.supersededBy || item.status !== 'active') return null;
  return (
    <section className={styles.panel} aria-label={t('The fact changed')}>
      <Heading variant="headline">{t('Is this no longer true?')}</Heading>
      <Caption>{t('The new value will replace this one, and the old one stays under “Outdated”.')}</Caption>
      <Field label={t('New value')} value={value} onChange={(event) => setValue(event.target.value)} autoComplete="off" />
      <Button
        variant="secondary"
        size="md"
        disabled={busy || value.trim() === ''}
        onClick={() =>
          void run(async () => {
            await supersedeFact(item, value);
            setValue('');
            toast.show({ message: t('Fact updated.') });
          })
        }
      >
        {t('Replace')}
      </Button>
    </section>
  );
}
