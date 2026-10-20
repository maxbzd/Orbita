import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useCapture, useCaptureItems, usePeople, useSettings } from '../../db/hooks';
import type { ID, Item } from '../../domain/types';
import { recorderService, useJob } from '../../state';
import { useAura } from '../../ui/shell/ShellContext';
import { Orb } from '../../ui/orb';
import { Body, Button, Caption, Display, Pill, Skeleton, Thought, useToast } from '../../ui/primitives';
import { CardStack } from './CardStack';
import { DoneView } from './DoneView';
import { EditItemSheet } from './EditItemSheet';
import { FastPath } from './FastPath';
import { ProcessingView } from './ProcessingView';
import { FailedScreen, MissingScreen, SkippedScreen, WaitingScreen } from './StatusViews';
import { acceptAllClear, acceptItem, dismissItem, setAutoAccept, undoDecision } from './actions';
import { deriveReviewView, foundTitle, memoryPhrase } from './model';
import styles from './Review.module.css';
import { t } from '../../i18n';

const UNDO_MS = 5000;
const DECISION_TOAST = 'review-decision';

/** Cards in the order the stack was opened in; anything new goes last. */
export function orderedBy(items: readonly Item[], order: readonly ID[]): Item[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

/**
 * `/review/:captureId`: everything after «Готово». The screen follows the capture, its objects and the processing job
 * live, so it is right whether the user waited here, came back from another screen, or opened a link next week.
 */
export function ReviewScreen() {
  const { captureId = '' } = useParams();
  const toast = useToast();
  const capture = useCapture(captureId);
  const items = useCaptureItems(captureId);
  const job = useJob(captureId);
  const people = usePeople({ includeArchived: true });
  const settings = useSettings();
  useAura(null, 0.25);

  useEffect(() => () => recorderService.dismissReview(captureId), [captureId]);

  const peopleById = useMemo(() => new Map((people ?? []).map((person) => [person.id, person])), [people]);
  const view = deriveReviewView({ capture, items, job });

  const [mode, setMode] = useState<'list' | 'cards'>('list');
  const [sheetOpen, setSheetOpen] = useState(true);
  const [order, setOrder] = useState<ID[]>([]);
  const [total, setTotal] = useState(0);
  const [questionDone, setQuestionDone] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  const proposed = view.kind === 'review' ? view.proposed : [];
  const question = questionDone ? undefined : job?.result?.questionsForUser[0];

  // A repeat run or a new result starts the list again.
  useEffect(() => {
    if (view.kind !== 'review') {
      setMode('list');
      setSheetOpen(true);
    }
  }, [view.kind]);

  const failed = useCallback(() => toast.show({ message: t('Could not save the decision. Try again.'), tone: 'danger' }), [toast]);

  const accept = useCallback(
    async (item: Item, edits?: { title: string; body: string | undefined }) => {
      try {
        const saved = await acceptItem(item.id, edits ?? {});
        toast.show({
          id: DECISION_TOAST,
          message: t('Added to memory: {memoryPhrase}', { memoryPhrase: memoryPhrase(saved, peopleById) }),
          actionLabel: t('Cancel'),
          duration: UNDO_MS,
          onAction: () => void undoDecision(item.id),
        });
      } catch {
        failed();
      }
    },
    [toast, peopleById, failed],
  );

  const dismiss = useCallback(
    async (item: Item) => {
      try {
        await dismissItem(item.id);
        toast.show({ id: DECISION_TOAST, message: t('Dismissed.'), actionLabel: t('Cancel'), duration: UNDO_MS, onAction: () => void undoDecision(item.id) });
      } catch {
        failed();
      }
    },
    [toast, failed],
  );

  const acceptAll = useCallback(async () => {
    try {
      const accepted = await acceptAllClear(captureId);
      toast.show({
        id: DECISION_TOAST,
        message: t('Added to memory: {count}', { count: accepted.length }, 'review-screen'),
        actionLabel: t('Cancel'),
        duration: UNDO_MS,
        onAction: () => void Promise.all(accepted.map((item) => undoDecision(item.id))),
      });
    } catch {
      failed();
    }
  }, [captureId, toast, failed]);

  const startCards = useCallback(
    (startId?: ID) => {
      const ids = proposed.map((item) => item.id);
      const at = startId ? ids.indexOf(startId) : 0;
      setOrder(at > 0 ? [...ids.slice(at), ...ids.slice(0, at)] : ids);
      setTotal(ids.length);
      setMode('cards');
      setSheetOpen(false);
    },
    [proposed],
  );

  const exitCards = useCallback(() => {
    setMode('list');
    setSheetOpen(true);
  }, []);

  const autoPercent = Math.round((settings?.autoAccept.enabled ? settings.autoAccept.minConfidence : 0.8) * 100);

  let body;
  switch (view.kind) {
    case 'loading':
      body = (
        <div className={styles.center} aria-busy="true">
          <Skeleton shape="circle" width={140} height={140} label={t('Loading the record')} />
          <Skeleton width="60%" />
        </div>
      );
      break;
    case 'missing':
      body = <MissingScreen />;
      break;
    case 'processing':
      body = capture ? <ProcessingView capture={capture} job={job} stage={view.stage} manual={view.manual} /> : null;
      break;
    case 'waiting':
      body = capture ? <WaitingScreen capture={capture} view={view} /> : null;
      break;
    case 'failed':
      body = capture ? <FailedScreen capture={capture} message={view.message} /> : null;
      break;
    case 'skipped':
      body = capture ? <SkippedScreen capture={capture} /> : null;
      break;
    case 'done':
      body = capture ? <DoneView capture={capture} accepted={view.accepted} dismissed={view.dismissed} people={peopleById} result={job?.result} /> : null;
      break;
    case 'review':
      body = capture ? (
        mode === 'cards' ? (
          <CardStack
            capture={capture}
            items={orderedBy(view.proposed, order)}
            total={Math.max(total, view.proposed.length)}
            people={peopleById}
            question={question}
            onQuestionDone={() => setQuestionDone(true)}
            onAccept={(item) => void accept(item)}
            onDismiss={(item) => void dismiss(item)}
            onEdit={setEditing}
            onExit={exitCards}
          />
        ) : (
          <section className={styles.center} aria-labelledby="found-title" data-testid="review-found">
            <div className={styles.orb}>
              <Orb size={140} state="done" />
            </div>
            <Pill tone="ok" dot live className={styles.pill}>
              {t('Recorded')}
            </Pill>
            <Display as="h2" size="xl" id="found-title" className={styles.title}>
              {capture.title ?? foundTitle(view.proposed.length)}
            </Display>
            {capture.summary ? (
              <Body tone="muted" className={styles.note}>
                {capture.summary}
              </Body>
            ) : null}
            <Caption>{foundTitle(view.proposed.length)}</Caption>
            {!sheetOpen ? (
              <div className={styles.actions}>
                <Button variant="primary" onClick={() => setSheetOpen(true)}>
                  
                  {t('Review ({count})', { count: view.proposed.length })}
                
                </Button>
                <Button variant="secondary" onClick={() => startCards()}>
                  {t('One by one')}
                </Button>
              </div>
            ) : null}
            <blockquote className={styles.snippet}>
              <Thought size="sm">{capture.text.length > 280 ? `${capture.text.slice(0, 279).trimEnd()}…` : capture.text}</Thought>
            </blockquote>
          </section>
        )
      ) : null;
      break;
  }

  return (
    <div className={styles.screen} data-view={view.kind}>
      <h1 className="sr-only">{t('Review', undefined, 'review-screen')}</h1>
      {body}

      {capture && view.kind === 'review' ? (
        <>
          <FastPath
            open={sheetOpen && mode === 'list'}
            onClose={() => setSheetOpen(false)}
            capture={capture}
            proposed={view.proposed}
            people={peopleById}
            result={job?.result}
            question={question}
            onQuestionDone={() => setQuestionDone(true)}
            autoAccept={settings?.autoAccept.enabled ?? false}
            autoAcceptPercent={autoPercent}
            onAutoAccept={(enabled) => void setAutoAccept(enabled)}
            onAcceptAll={() => void acceptAll()}
            onOneByOne={startCards}
            onAccept={(item) => void accept(item)}
            onDismiss={(item) => void dismiss(item)}
          />
          <EditItemSheet
            item={editing}
            onClose={() => setEditing(null)}
            onSave={(item, edits) => {
              setEditing(null);
              void accept(item, edits);
            }}
          />
        </>
      ) : null}
    </div>
  );
}

