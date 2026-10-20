import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useProjects, useSettings } from '../../db/hooks';
import { recorderService, useRecorder, useWalkMode } from '../../state';
import { LevelBars, LiveTranscript, RecordControls, TimeDisplay } from '../../ui/audio';
import { Orb, useOrbLevel } from '../../ui/orb';
import type { OrbState } from '../../ui/orb';
import { Button, Caption, IconButton, Pill, useToast } from '../../ui/primitives';
import { ContextChips } from './ContextChips';
import { MicDenied } from './MicDenied';
import { TextCapture } from './TextCapture';
import { draftStore, keepOpenHint } from './storage';
import styles from './CaptureScreen.module.css';
import { t } from '../../i18n';

const FIRST_HINT_MS = 7_000;

/** Back where the user came from; straight to «Сегодня» when the screen was opened by a link or a shortcut. */
function useLeave(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index > 0) navigate(-1);
    else navigate('/today', { replace: true });
  }, [navigate]);
}

const isTyping = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(target.tagName));

/**
 * The recording screen: full screen, no navigation. The recording belongs to
 * `recorderService`, not to this screen: leaving it (the mini recorder takes over) neither stops nor restarts anything.
 */
export function CaptureScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const leave = useLeave();
  const [params] = useSearchParams();
  const projects = useProjects('active') ?? [];

  const phase = useRecorder((state) => state.phase);
  const starting = useRecorder((state) => state.starting);
  const captureId = useRecorder((state) => state.captureId);
  const elapsedMs = useRecorder((state) => state.elapsedMs);
  const transcript = useRecorder((state) => state.transcript);
  const dictation = useRecorder((state) => state.dictation);
  const micProblem = useRecorder((state) => state.micProblem);
  const notice = useRecorder((state) => state.notice);
  const context = useRecorder((state) => state.context);
  const projectIds = useRecorder((state) => state.projectIds);

  const recording = phase === 'recording' || phase === 'paused';
  const paused = phase === 'paused';
  const level = useOrbLevel(recorderService.level, phase === 'recording');
  // Settings → Захват → «Режим прогулки»: off means the screen never goes dark on its own.
  const walkModeOn = useSettings()?.capture.walkMode ?? true;
  const { walking, wake } = useWalkMode(phase === 'recording' && walkModeOn);

  const [textMode, setTextMode] = useState(params.get('mode') === 'text');
  const [typed, setTyped] = useState(() => (params.get('mode') === 'text' ? draftStore.load() : ''));
  const [typedBusy, setTypedBusy] = useState(false);
  const [typedError, setTypedError] = useState<string | undefined>();
  const [captions, setCaptions] = useState(true);
  const [firstHint, setFirstHint] = useState(false);

  // ───── Start: by the link or the shortcut (the tap that comes from the shell has started it already).
  const autostarted = useRef(false);
  useEffect(() => {
    if (autostarted.current) return;
    autostarted.current = true;
    if (params.get('autostart') === '1' && params.get('mode') !== 'text' && !recorderService.store.getState().micProblem) {
      void recorderService.start();
    }
    // Opened with a stale result of an earlier recording: nothing to show here, the screen is a fresh start.
  }, [params]);

  // ───── «Готово» (here, from the mini recorder, or after an interruption) moves on to the review.
  const wasRecording = useRef(recording);
  useEffect(() => {
    if (wasRecording.current && (phase === 'processing' || phase === 'review') && captureId) {
      navigate(`/review/${captureId}`, { replace: true });
    }
    wasRecording.current = recording;
  }, [phase, recording, captureId, navigate]);

  // ───── Warnings of the recorder and the dictation arrive as toasts, once.
  useEffect(() => {
    if (!notice) return;
    toast.show({ message: notice, id: 'recorder-notice', duration: 8000 });
    recorderService.clearNotice();
  }, [notice, toast]);

  // ───── «Не закрывай приложение во время записи»: the first recording only, for a few seconds.
  const hintTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (phase !== 'recording' || hintTimer.current !== undefined || keepOpenHint.seen()) return;
    keepOpenHint.markSeen();
    setFirstHint(true);
    hintTimer.current = window.setTimeout(() => setFirstHint(false), FIRST_HINT_MS);
  }, [phase]);
  useEffect(() => () => window.clearTimeout(hintTimer.current), []);

  // ───── Actions
  const start = useCallback(() => void recorderService.start(), []);
  const close = useCallback(async () => {
    if (recording) {
      const outcome = await recorderService.cancel();
      if (outcome.kind === 'undoable') {
        toast.show({
          message: t('Recording cancelled.'),
          actionLabel: t('Restore'),
          duration: 5000,
          onAction: () => void outcome.undo().then((id) => navigate(`/review/${id}`)),
        });
      }
    }
    leave();
  }, [recording, toast, leave, navigate]);

  const done = useCallback(() => {
    void recorderService.done();
  }, []);

  const togglePause = useCallback(() => (paused ? recorderService.resume() : recorderService.pause()), [paused]);

  const openText = useCallback(() => {
    if (recording) {
      recorderService.pause();
      const heard = [transcript.final, transcript.interim].filter(Boolean).join(' ');
      setTyped((current) => (current.trim() === '' ? heard : current));
    }
    setTextMode(true);
  }, [recording, transcript]);

  const saveTyped = useCallback(async () => {
    const text = typed.trim();
    if (text === '' || typedBusy) return;
    setTypedBusy(true);
    setTypedError(undefined);
    try {
      if (recording) {
        // The author edited the transcript of a running recording: that text, with the audio, is the capture.
        await recorderService.done({ text });
      } else {
        const id = await recorderService.saveText(text, { ...(context && { context }), projectIds });
        navigate(`/review/${id}`, { replace: true });
      }
      draftStore.clear();
    } catch {
      setTypedError(t('Could not save. The text stayed in the field: try again.'));
    } finally {
      setTypedBusy(false);
    }
  }, [typed, typedBusy, recording, context, projectIds, navigate]);

  const backToVoice = useCallback(() => {
    setTextMode(false);
    if (paused) recorderService.resume();
    else if (!recording) void recorderService.start();
  }, [paused, recording]);

  // The draft survives a closed tab, as long as no recording is attached to it.
  useEffect(() => {
    if (textMode && !recording) draftStore.save(typed);
  }, [textMode, recording, typed]);

  // ───── Keyboard: Space pauses (or starts), Ctrl/⌘+Enter finishes, Esc leaves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey) return;
      if (event.key === ' ' && !isTyping(event.target) && !textMode) {
        event.preventDefault();
        if (!recording) start();
        else togglePause();
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && recording && !textMode) {
        event.preventDefault();
        done();
      } else if (event.key === 'Escape' && !textMode) {
        void close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [textMode, recording, start, togglePause, done, close]);

  // ───── What the orb and the status say
  const orbState: OrbState = paused ? 'paused' : recording ? 'listening' : 'idle';
  const status = starting ? t('Turning the microphone on') : paused ? t('Pause') : recording ? t('Listening') : t('Tap and speak');
  const seconds = elapsedMs / 1000;
  const showWave = recording && !paused && dictation === 'unsupported';
  const showTranscript = recording && captions && dictation !== 'unsupported';

  const stageClass = [styles.root, walking ? styles.walk : ''].filter(Boolean).join(' ');

  return (
    <div className={stageClass} data-walk={walking ? '' : undefined} data-phase={phase} data-testid="capture-screen">
      <div className={styles.blackout} aria-hidden="true" />
      <h1 className="sr-only">{t('Record')}</h1>

      <header className={styles.top}>
        <IconButton icon="close" label={recording ? t('Cancel the recording') : t('Close')} variant="ghost" onClick={() => void close()} />
        <div className={styles.timer}>
          {recording ? (
            <>
              <span className={styles.dot} aria-hidden="true" data-paused={paused ? '' : undefined} />
              <TimeDisplay seconds={seconds} size="sm" timer blink={paused} label={t('Record')} />
            </>
          ) : (
            <Caption>{textMode ? t('Text') : t('New recording')}</Caption>
          )}
        </div>
        {recording && !textMode ? (
          <button
            type="button"
            className={styles.cc}
            aria-pressed={captions}
            aria-label={captions ? t('Hide live text') : t('Show live text')}
            onClick={() => setCaptions((value) => !value)}
          >
            CC
          </button>
        ) : (
          <span className={styles.cc} aria-hidden="true" data-empty="" />
        )}
      </header>

      {micProblem && !recording ? (
        <MicDenied
          message={micProblem.message}
          code={micProblem.code}
          onType={() => {
            recorderService.clearMicProblem();
            setTextMode(true);
            setTyped(draftStore.load());
          }}
          onRetry={() => {
            recorderService.clearMicProblem();
            start();
          }}
          onBack={() => {
            recorderService.clearMicProblem();
            leave();
          }}
        />
      ) : textMode ? (
        <TextCapture
          value={typed}
          onChange={setTyped}
          onDone={() => void saveTyped()}
          onVoice={micProblem ? undefined : backToVoice}
          voiceLabel={recording ? t('Continue') : t('Voice')}
          recordingPaused={recording}
          busy={typedBusy}
          error={typedError}
        />
      ) : (
        <>
          <div className={styles.stage}>
            <div className={styles.orbWrap}>
              {recording ? (
                <Orb size={220} state={orbState} level={level} walk={walking} />
              ) : (
                <button type="button" className={styles.orbButton} onClick={start} aria-label={t('Start recording')}>
                  <Orb size={220} state="idle" />
                </button>
              )}
            </div>

            <Pill tone={recording && !paused ? 'rec' : 'neutral'} dot={recording} blink={paused} live className={styles.status}>
              {status}
            </Pill>

            <div className={styles.transcript}>
              {showTranscript ? <LiveTranscript final={transcript.final} interim={transcript.interim} lines={4} /> : null}
              {showWave ? (
                <div className={styles.wave}>
                  <LevelBars level={level} bars={32} />
                  <Caption className={styles.waveNote}>{t('Live text is not available here. Recording goes on, and the words will appear after processing.')}</Caption>
                </div>
              ) : null}
              {firstHint ? <Caption className={styles.firstHint}>{t('Do not close the app while recording.')}</Caption> : null}
            </div>
          </div>

          <footer className={styles.bottom}>
            <ContextChips
              context={context}
              projects={projects}
              projectIds={projectIds}
              onContext={(value) => recorderService.setContext(value)}
              onProjects={(ids) => recorderService.setProjects(ids)}
            />
            {recording ? (
              <RecordControls paused={paused} onText={openText} onDone={done} onTogglePause={togglePause} disabled={starting} />
            ) : (
              <div className={styles.idleControls}>
                <IconButton icon="text" label={t('Text')} variant="glass" size="lg" onClick={() => setTextMode(true)} />
                <Button variant="primary" size="lg" iconStart="mic" onClick={start}>
                  {t('Record', undefined, 'capture-screen')}
                </Button>
                <span />
              </div>
            )}
          </footer>
        </>
      )}

      {walking ? <button type="button" className={styles.wake} onClick={wake} aria-label={t('The screen is dimmed. Tap to bring it back')} /> : null}
    </div>
  );
}
