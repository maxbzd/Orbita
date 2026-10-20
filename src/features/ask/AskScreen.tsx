import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { QUICK_QUESTIONS, ask, checkAiReadiness, createLlmProvider, isAiError } from '../../ai';
import { getSettings } from '../../db';
import { useSettings } from '../../db/hooks';
import { Body, Button, Caption, Chip, Display, EmptyState, IconButton, Pill, Skeleton, TextArea, Thought } from '../../ui';
import { AnswerView } from './AnswerView';
import { ManualPanel } from './ManualPanel';
import { askErrorText, historyOf, questionFromSearch, stripCodes } from './model';
import type { Turn } from './model';
import { useDictation } from './useDictation';
import styles from './Ask.module.css';
import { t } from '../../i18n';

const MAX_QUESTION = 500;

export default function AskScreen() {
  const settings = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const turnsRef = useRef<Turn[]>([]);
  const nextId = useRef(1);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const handledQuery = useRef(false);
  const dictation = useDictation(settings?.stt.language ?? 'ru');

  const readiness = settings ? checkAiReadiness(settings) : null;
  const manual = settings?.ai.provider === 'manual';
  const busy = turns.some((turn) => turn.status === 'thinking');

  const patch = useCallback((id: number, change: Partial<Turn>): void => {
    setTurns((prev) => {
      const next = prev.map((turn) => (turn.id === id ? { ...turn, ...change } : turn));
      turnsRef.current = next;
      return next;
    });
  }, []);

  const send = useCallback(
    async (raw: string): Promise<void> => {
      const question = raw.trim().slice(0, MAX_QUESTION);
      if (question === '' || turnsRef.current.some((turn) => turn.status === 'thinking')) return;
      const id = nextId.current++;
      const history = historyOf(turnsRef.current);
      const fresh: Turn = { id, question, status: 'thinking', partial: '' };
      turnsRef.current = [...turnsRef.current, fresh];
      setTurns(turnsRef.current);
      setText('');
      const controller = new AbortController();
      abort.current = controller;
      try {
        const llm = createLlmProvider(await getSettings());
        let streamed = '';
        const answer = await ask(question, {
          llm,
          history,
          signal: controller.signal,
          onToken: (token) => {
            streamed += token;
            patch(id, { partial: streamed });
          },
        });
        patch(id, { status: 'done', answer, partial: answer.text });
      } catch (error) {
        if (controller.signal.aborted || (isAiError(error) && error.code === 'aborted')) {
          patch(id, { status: 'stopped' });
        } else {
          patch(id, { status: 'error', error: askErrorText(error) });
        }
      } finally {
        if (abort.current === controller) abort.current = null;
      }
    },
    [patch],
  );

  // ?q=… asks once, then clears the parameter so a reload does not ask again.
  useEffect(() => {
    if (handledQuery.current || !settings || !readiness) return;
    const question = questionFromSearch(location.search);
    if (!question) return;
    handledQuery.current = true;
    navigate('/ask', { replace: true });
    if (readiness.ready) void send(question);
    else setText(question);
  }, [settings, readiness, location.search, navigate, send]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [turns.length, busy]);
  useEffect(() => () => abort.current?.abort(), []);

  const toggleMic = async (): Promise<void> => {
    if (dictation.listening) {
      const spoken = await dictation.stop();
      if (spoken.trim() !== '') setText((current) => [current.trim(), spoken.trim()].filter(Boolean).join(' '));
    } else {
      dictation.start();
    }
  };

  const submit = (): void => {
    void (async () => {
      const spoken = dictation.listening ? await dictation.stop() : '';
      await send([text.trim(), spoken.trim()].filter(Boolean).join(' '));
    })();
  };

  if (!settings) return <div className={styles.screen} aria-busy="true" />;

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <Display as="h1" size="l" className={styles.title}>
          {t('Ask')}
        </Display>
        <Body tone="muted">{t('A question to your own life: the answer is built only from your records and objects, with links to the sources.')}</Body>
      </header>

      {readiness && !readiness.ready ? (
        <div className={styles.notice} role="note">
          <Body>{readiness.reason ?? t('AI is not connected.')}</Body>
          <div className={styles.row}>
            <Button size="sm" variant="primary" onClick={() => navigate('/settings?section=ai')}>
              {t('Open AI settings')}
            </Button>
          </div>
          <Caption>{t('Or choose the “No AI” mode in settings: the app will prepare a request, and you will get the answer in any AI chat.')}</Caption>
        </div>
      ) : null}

      {turns.length === 0 ? (
        <>
          <EmptyState
            illustration="ring"
            title={t('What would you like to ask?')}
            description={t('For example, what you promised, what you avoid, or what you decided this month and why.')}
          />
          <div className={styles.quick} role="group" aria-label={t('Quick questions')}>
            {QUICK_QUESTIONS.map((question) => (
              <Chip key={question} onClick={() => void send(t(question))} disabled={busy || (readiness !== null && !readiness.ready)}>
                {t(question)}
              </Chip>
            ))}
          </div>
        </>
      ) : (
        <ol className={styles.turns} aria-label={t('Conversation')}>
          {turns.map((turn) => (
            <li key={turn.id} className={styles.turn}>
              <p className={styles.question}>{turn.question}</p>
              <div className={styles.answer} data-status={turn.status} aria-live={turn.status === 'thinking' ? 'polite' : undefined}>
                {turn.status === 'thinking' ? (
                  <>
                    <Pill tone="ai" dot live>
                      {t('AI is thinking')}
                    </Pill>
                    {manual ? (
                      <Caption>{t('The answer will come through the clipboard: follow the steps below.')}</Caption>
                    ) : stripCodes(turn.partial).trim() === '' ? (
                      <div className={styles.skeleton} aria-hidden="true">
                        <Skeleton height={14} />
                        <Skeleton height={14} width="80%" />
                      </div>
                    ) : (
                      <Thought as="div" className={styles.answerText}>
                        {stripCodes(turn.partial)}
                      </Thought>
                    )}
                  </>
                ) : null}
                {turn.status === 'done' && turn.answer ? <AnswerView answer={turn.answer} /> : null}
                {turn.status === 'error' ? (
                  <>
                    <Body role="alert" className={styles.error}>
                      {turn.error}
                    </Body>
                    <div className={styles.row}>
                      <Button size="sm" variant="secondary" onClick={() => void send(turn.question)} disabled={busy}>
                        {t('Try again')}
                      </Button>
                      <Link to="/settings?section=ai" className={styles.link}>
                        {t('AI settings')}
                      </Link>
                    </div>
                  </>
                ) : null}
                {turn.status === 'stopped' ? <Caption>{t('Stopped.')}</Caption> : null}
              </div>
            </li>
          ))}
        </ol>
      )}

      {manual && busy ? <ManualPanel /> : null}
      {turns.length > 0 && !busy ? (
        <div className={styles.quick} role="group" aria-label={t('Quick questions')}>
          {QUICK_QUESTIONS.slice(0, 3).map((question) => (
            <Chip key={question} onClick={() => void send(t(question))} disabled={readiness !== null && !readiness.ready}>
              {t(question)}
            </Chip>
          ))}
        </div>
      ) : null}
      <div ref={endRef} className={styles.end} />

      <form
        className={styles.composer}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {dictation.error ? (
          <Caption role="status" className={styles.error}>
            {dictation.error}
          </Caption>
        ) : null}
        <div className={styles.inputRow}>
          <TextArea
            aria-label={t('Your question')}
            placeholder={dictation.listening ? t('Listening…') : t('Ask about your life')}
            value={dictation.listening ? [text.trim(), dictation.text].filter(Boolean).join(' ') : text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                submit();
              }
            }}
            maxLength={MAX_QUESTION}
            rows={1}
            autoGrow
            maxRows={5}
            containerClassName={styles.input}
            readOnly={dictation.listening}
          />
          {dictation.supported ? (
            <IconButton
              icon="mic"
              label={dictation.listening ? t('Stop dictation') : t('Dictate a question')}
              pressed={dictation.listening}
              variant="glass"
              onClick={() => void toggleMic()}
              disabled={busy}
            />
          ) : null}
          {busy ? (
            <IconButton icon="stop" label={t('Stop')} variant="filled" onClick={() => abort.current?.abort()} />
          ) : (
            <IconButton icon="ask" label={t('Send the question')} variant="filled" type="submit" disabled={(text.trim() === '' && !dictation.listening) || (readiness !== null && !readiness.ready && !manual)} />
          )}
        </div>
      </form>
    </div>
  );
}
