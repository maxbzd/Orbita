import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { capturesRepo, itemsRepo } from '../../db';
import { useCapture, useCaptureItems, usePeople, useProjects } from '../../db/hooks';
import type { Capture, CaptureContext, ID, Item } from '../../domain/types';
import { newId } from '../../domain/ids';
import { formatDayWithWeekday, formatDuration, formatTime, nowISO } from '../../domain/dates';
import { useReducedMotion } from '../../styles/theme';
import { Button, Chip, ConfirmDialog, EmptyState, Field, Icon, IconButton, Label, Pill, Skeleton, TextArea, formatClock, useToast } from '../../ui';
import type { AudioMarker } from '../../ui';
import { INBOX_ACTION_LABELS, CAPTURE_KIND_LABELS, inboxAction, isInboxStatus, statusLabel } from '../stream/rowModel';
import { outcomeMessage, runProcessing } from '../stream/processing';
import { useAudioPlayer, useRecording, useWaveformPeaks } from './hooks';
import type { ItemAction } from './itemModel';
import { MarksPanel } from './MarksPanel';
import type { MarkDraft } from './MarksPanel';
import { ObjectCard } from './ObjectCard';
import { PlayerCard } from './PlayerCard';
import { TranscriptView } from './TranscriptView';
import type { QuoteInfo } from './TranscriptView';
import { buildMarkers, locateQuote, locateQuotes, offsetToSeconds, phraseAt, splitSentences } from './transcript';
import styles from './EntryScreen.module.css';
import { tx } from '../../i18n/react';
import { t } from '../../i18n';

const CONTEXT_LABELS: Record<CaptureContext, string> = { get walk() { return t('Walk') }, get home() { return t('Home') }, get transit() { return t('On the way') }, get work() { return t('Work') }, get other() { return t('Other') } };
const FLASH_MS = 1600;

const escapeAttr = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** «Запись (детально)»: loads the record and chooses between "no such record", "in the trash" and the record itself. */
export default function EntryScreen() {
  const { captureId } = useParams();
  const capture = useCapture(captureId);
  const items = useCaptureItems(captureId);

  if (capture === undefined || items === undefined) {
    return (
      <section className={styles.screen} aria-busy="true">
        <Skeleton shape="block" height={28} width={120} label={t('Loading the record')} />
        <Skeleton shape="block" height={120} />
        <Skeleton shape="block" height={160} />
      </section>
    );
  }
  if (capture === null) {
    return (
      <section className={styles.screen}>
        <EmptyState
          title={t('There is no such record.')}
          description={t('Perhaps it was deleted for good.')}
          action={
            <Link to="/stream" className={styles.plainLink}>
              <Button variant="secondary" size="sm" iconStart="chevron-left" tabIndex={-1}>
                {t('To the stream')}
              </Button>
            </Link>
          }
        />
      </section>
    );
  }
  if (capture.deletedAt) return <TrashedEntry capture={capture} />;
  return <EntryView capture={capture} items={items} />;
}

function TrashedEntry({ capture }: { capture: Capture }) {
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <section className={styles.screen}>
      <EmptyState
        title={t('This record is in the trash.')}
        description={t('It can be restored until it is deleted for good.')}
        action={
          <Button
            variant="primary"
            onClick={async () => {
              await capturesRepo.restore(capture.id);
              toast.show({ message: t('The record is restored.') });
              navigate(`/entry/${capture.id}`, { replace: true });
            }}
          >
            {t('Restore')}
          </Button>
        }
      />
    </section>
  );
}

interface FlashState {
  kind: 'quote' | 'card';
  id: ID;
}

function EntryView({ capture, items }: { capture: Capture; items: Item[] }) {
  const navigate = useNavigate();
  const toast = useToast();
  const reduced = useReducedMotion();
  const [params] = useSearchParams();
  const people = usePeople();
  const projects = useProjects();

  // ───── audio
  const recording = useRecording(capture.audioId);
  const ready = recording.status === 'ready';
  const wave = useWaveformPeaks(capture.audioId, ready);
  const player = useAudioPlayer(capture.durationSec ?? wave.durationSec);
  const duration = ready ? player.duration : (capture.durationSec ?? 0);

  // ───── what the text and the objects say
  const text = capture.text;
  const shown = useMemo(() => items.filter((item) => item.status !== 'dismissed'), [items]);
  const dismissed = useMemo(() => items.filter((item) => item.status === 'dismissed'), [items]);
  const quotes = useMemo(() => locateQuotes(text, shown), [text, shown]);
  const quoteById = useMemo(() => new Map(quotes.map((quote) => [quote.itemId, quote])), [quotes]);
  const info = useMemo(() => new Map<ID, QuoteInfo>(shown.map((item) => [item.id, { kind: item.kind, title: item.title }])), [shown]);
  const markers = useMemo<AudioMarker[]>(() => (ready && duration > 0 ? buildMarkers(text, shown, duration) : []), [ready, duration, text, shown]);
  const phrases = useMemo(() => splitSentences(text), [text]);
  const phraseIndex = ready && player.started ? phraseAt(phrases, text.length, duration, player.currentTime) : -1;
  const currentPhrase = phraseIndex >= 0 ? (phrases[phraseIndex] ?? null) : null;

  // ───── selection, flashing, scrolling
  const [selectedId, setSelectedId] = useState<ID | null>(null);
  const [flash, setFlash] = useState<FlashState | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const objectsRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!flash) return undefined;
    const id = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => window.clearTimeout(id);
  }, [flash]);

  const scrollTo = useCallback(
    (element: Element | null | undefined) => element?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' }),
    [reduced],
  );

  /** Object → its quote in the text (and, with a recording, the second it is said). */
  const showSource = useCallback(
    (itemId: ID, { seek = true }: { seek?: boolean } = {}) => {
      const quote = quoteById.get(itemId);
      setSelectedId(itemId);
      if (!quote) return;
      setFlash({ kind: 'quote', id: itemId });
      scrollTo(transcriptRef.current?.querySelector(`[data-quote-ids~="${escapeAttr(itemId)}"]`));
      if (seek && ready && duration > 0) player.seek(offsetToSeconds(quote.start, text.length, duration));
    },
    [quoteById, ready, duration, player, text.length, scrollTo],
  );

  /** Quote → its object in the list. */
  const showObject = useCallback(
    (itemId: ID) => {
      setSelectedId(itemId);
      setFlash({ kind: 'card', id: itemId });
      scrollTo(objectsRef.current?.querySelector(`[data-item="${escapeAttr(itemId)}"]`));
      const quote = quoteById.get(itemId);
      if (quote && ready && duration > 0) player.seek(offsetToSeconds(quote.start, text.length, duration));
    },
    [quoteById, ready, duration, player, text.length, scrollTo],
  );

  // A link from elsewhere (`/entry/:id?item=…`) lands on the quote of that object, once.
  const linkedItem = params.get('item');
  const handledLink = useRef<string | null>(null);
  useEffect(() => {
    if (!linkedItem || handledLink.current === linkedItem) return;
    if (!shown.some((item) => item.id === linkedItem)) return;
    handledLink.current = linkedItem;
    showSource(linkedItem, { seek: false });
  }, [linkedItem, shown, showSource]);

  // "Назад к текущему": the phrase that plays is out of sight.
  const [offscreen, setOffscreen] = useState(false);
  useEffect(() => {
    if (!player.playing) {
      setOffscreen(false);
      return undefined;
    }
    const check = (): void => {
      const element = transcriptRef.current?.querySelector('[data-current]');
      if (!element) return setOffscreen(false);
      const rect = element.getBoundingClientRect();
      setOffscreen(rect.bottom < 0 || rect.top > window.innerHeight);
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    return () => window.removeEventListener('scroll', check);
  }, [player.playing, phraseIndex]);

  // ───── title
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const title = capture.title?.trim() ?? '';
  const fallbackTitle = capture.kind === 'voice' ? t('Voice recording') : t('Record');
  const saveTitle = async (): Promise<void> => {
    setEditingTitle(false);
    const next = titleDraft.trim();
    if (next !== title) await capturesRepo.update(capture.id, { title: next || undefined });
  };

  // ───── text
  const [editingText, setEditingText] = useState(false);
  const [textDraft, setTextDraft] = useState('');
  const startEditText = (): void => {
    setTextDraft(text);
    setEditingText(true);
  };
  const saveText = async (): Promise<void> => {
    const next = textDraft.replace(/\s+$/, '');
    setEditingText(false);
    if (next === text) return;
    await capturesRepo.update(capture.id, { text: next });
    // Offsets of quotes point into the old text: move them to where the quotes now are.
    for (const item of items) {
      const span = locateQuote(next, item.quote, item.quoteStart);
      if (span && span.start !== item.quoteStart) await itemsRepo.update(item.id, { quoteStart: span.start });
    }
    toast.show({ message: t('Text saved.'), actionLabel: t('Reprocess'), onAction: () => void reprocess() });
  };

  // ───── objects
  const [busyItems, setBusyItems] = useState<ReadonlySet<ID>>(new Set());
  const onItemAction = async (item: Item, action: ItemAction): Promise<void> => {
    setBusyItems((current) => new Set(current).add(item.id));
    try {
      switch (action) {
        case 'accept':
          await itemsRepo.accept(item.id);
          break;
        case 'dismiss':
          await itemsRepo.dismiss(item.id);
          break;
        case 'done':
          await itemsRepo.setStatus(item.id, 'done');
          break;
        case 'drop':
          await itemsRepo.setStatus(item.id, 'dropped');
          break;
        case 'reopen':
          await itemsRepo.reopen(item.id);
          break;
      }
    } catch {
      toast.show({ message: t('Could not change the object. Please try again.'), tone: 'danger' });
    } finally {
      setBusyItems((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  };
  const proposedCount = items.filter((item) => item.status === 'proposed').length;

  // ───── marks
  const [markDraft, setMarkDraft] = useState<MarkDraft | null>(null);
  const marks = capture.marks ?? [];
  const saveMark = async (draft: MarkDraft): Promise<void> => {
    const mark = { id: newId(), at: Math.round(draft.at * 10) / 10, text: draft.text, createdAt: nowISO() };
    await capturesRepo.update(capture.id, { marks: [...marks, mark].sort((a, b) => a.at - b.at) });
    setMarkDraft(null);
  };
  const removeMark = async (mark: (typeof marks)[number]): Promise<void> => {
    await capturesRepo.update(capture.id, { marks: marks.filter((other) => other.id !== mark.id) });
    toast.show({
      message: t('The mark is removed.'),
      actionLabel: t('Restore'),
      onAction: () => void capturesRepo.update(capture.id, { marks: [...marks].sort((a, b) => a.at - b.at) }),
    });
  };

  // ───── processing
  const [processingBusy, setProcessingBusy] = useState(false);
  const [confirmReprocess, setConfirmReprocess] = useState(false);
  const reprocess = useCallback(async (): Promise<void> => {
    setProcessingBusy(true);
    const result = await runProcessing(capture.id);
    setProcessingBusy(false);
    if (!result.ok) toast.show({ message: result.message, tone: 'danger', duration: 8000 });
    else toast.show({ message: outcomeMessage(result.outcome), tone: result.outcome === 'review' ? 'ok' : 'default' });
  }, [capture.id, toast]);

  const action = inboxAction(capture.status);
  const onInboxAction = async (): Promise<void> => {
    if (action === 'review') navigate(`/review/${capture.id}`);
    else if (action === 'process' || action === 'retry') await reprocess();
  };

  // ───── deleting
  const removeCapture = async (): Promise<void> => {
    const proposed = items.filter((item) => item.status === 'proposed').map((item) => item.id);
    await capturesRepo.remove(capture.id);
    navigate('/stream', { replace: true });
    toast.show({
      message: t('The record is deleted.'),
      actionLabel: t('Restore'),
      duration: 5000,
      onAction: () => {
        void (async () => {
          await capturesRepo.restore(capture.id);
          // Deleting dismissed what was waiting for review; put it back.
          for (const id of proposed) await itemsRepo.update(id, { status: 'proposed' });
          toast.show({ message: t('The record is restored.') });
        })();
      },
    });
  };

  // ───── header data
  const back = (event: MouseEvent): void => {
    if ((window.history.state as { idx?: number } | null)?.idx) {
      event.preventDefault();
      navigate(-1);
    }
  };
  const personNames = (capture.personIds.map((id) => people?.find((person) => person.id === id)).filter(Boolean) as NonNullable<typeof people>);
  const projectNames = (capture.projectIds.map((id) => projects?.find((project) => project.id === id)).filter(Boolean) as NonNullable<typeof projects>);
  const isVoice = capture.kind === 'voice' || capture.audioId !== undefined;
  const status = statusLabel(capture.status);

  const submitTitle = (event: FormEvent): void => {
    event.preventDefault();
    void saveTitle();
  };

  return (
    <article className={styles.screen} aria-labelledby="entry-title">
      <nav className={styles.nav} aria-label={t('Navigation of the record')}>
        <Link to="/stream" className={styles.back} onClick={back}>
          <Icon name="chevron-left" size={20} />
          {t('Stream')}
        </Link>
      </nav>

      <header className={styles.header}>
        <div className={styles.metaLine}>
          <Label>{CAPTURE_KIND_LABELS[capture.kind]}</Label>
          <span className={styles.when}>
            {formatDayWithWeekday(capture.day)}, {formatTime(capture.createdAt)}
          </span>
          {capture.context ? <span className={styles.when}>· {CONTEXT_LABELS[capture.context]}</span> : null}
          {capture.durationSec ? <span className={styles.when}>· {formatDuration(capture.durationSec)}</span> : null}
        </div>

        {editingTitle ? (
          <form className={styles.titleForm} onSubmit={submitTitle}>
            <Field
              label={t('Record title')}
              value={titleDraft}
              placeholder={fallbackTitle}
              autoFocus
              maxLength={120}
              onChange={(event) => setTitleDraft(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && setEditingTitle(false)}
              onBlur={() => void saveTitle()}
            />
          </form>
        ) : (
          <div className={styles.titleRow}>
            <h1 id="entry-title" className={styles.title}>
              {title || fallbackTitle}
            </h1>
            <IconButton
              icon="edit"
              label={t('Edit the title')}
              onClick={() => {
                setTitleDraft(title);
                setEditingTitle(true);
              }}
            />
          </div>
        )}
        {editingTitle ? <span id="entry-title" className="sr-only">{title || fallbackTitle}</span> : null}

        {capture.summary ? <p className={styles.summary}>{capture.summary}</p> : null}

        {personNames.length + projectNames.length + capture.tags.length > 0 ? (
          <div className={styles.links}>
            {personNames.map((person) => (
              <Link key={person.id} to={`/people/${person.id}`} className={styles.plainLink}>
                <Chip type="person">{person.name}</Chip>
              </Link>
            ))}
            {projectNames.map((project) => (
              <Chip key={project.id} type="project">
                {project.name}
              </Chip>
            ))}
            {capture.tags.map((tag) => (
              <Chip key={tag}>#{tag.replace(/^#/, '')}</Chip>
            ))}
          </div>
        ) : null}

        {capture.source?.importedFrom || capture.source?.url ? (
          <p className={styles.source}>
            
            {tx('Source: {v} {v2}', { v: capture.source.importedFrom ? { chatgpt: 'ChatGPT', claude: 'Claude', paste: t('pasted text'), share: t('“Share”') }[capture.source.importedFrom] : (capture.source.app ?? t('link')), v2: capture.source.url && /^https?:\/\//.test(capture.source.url) ? (
              <>
                {' '}
                <a href={capture.source.url} target="_blank" rel="noreferrer noopener">
                  {t('open')}
                </a>
              </>
            ) : null })}
          </p>
        ) : null}
      </header>

      {isInboxStatus(capture.status) ? (
        <div className={styles.banner} role="status">
          <div className={styles.bannerText}>
            <Pill tone={capture.status === 'failed' ? 'danger' : capture.status === 'review' ? 'ai' : 'neutral'} dot>
              {status}
            </Pill>
            {capture.status === 'failed' && capture.error ? <span className={styles.bannerError}>{capture.error}</span> : null}
          </div>
          {action && action !== 'busy' ? (
            <Button variant={action === 'retry' ? 'secondary' : 'primary'} size="sm" loading={processingBusy} onClick={() => void onInboxAction()}>
              {INBOX_ACTION_LABELS[action]}
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* ───── sound */}
      {ready ? (
        <PlayerCard
          src={recording.url}
          player={player}
          wave={wave}
          markers={markers}
          onMarkerSeek={(time, marker) => {
            player.seek(time);
            showObject(marker.id);
          }}
          onAddMark={() => setMarkDraft({ at: player.currentTime, text: '' })}
        />
      ) : isVoice ? (
        <div className={styles.noAudio} data-testid="no-audio">
          {recording.status === 'loading' ? (
            <Skeleton shape="block" height={96} label={t('Loading the sound')} />
          ) : (
            <>
              <Icon name="mic" size={20} />
              <p>
                {t('{v} Only the text remains{v2}.', { v: recording.status === 'missing'
                  ? t('The sound of this record was not found on the device.')
                  : t('This record has no sound.'), v2: capture.durationSec ? t('; spoke for {formatDuration}', { formatDuration: formatDuration(capture.durationSec) }) : '' })}
              
              </p>
            </>
          )}
        </div>
      ) : null}

      <MarksPanel
        marks={marks}
        draft={markDraft}
        onDraftChange={setMarkDraft}
        onSave={(draft) => void saveMark(draft)}
        onRemove={(mark) => void removeMark(mark)}
        onSeek={(seconds) => player.seek(seconds)}
      />

      {/* ───── transcript */}
      <section className={styles.block} aria-labelledby="entry-text">
        <div className={styles.blockHead}>
          <Label id="entry-text">{capture.kind === 'voice' ? t('Transcript') : t('Text')}</Label>
          {!editingText && text !== '' ? (
            <Button variant="ghost" size="sm" iconStart="edit" onClick={startEditText}>
              {t('Edit')}
            </Button>
          ) : null}
        </div>

        {editingText ? (
          <div className={styles.editor}>
            <TextArea
              aria-label={t('Record text')}
              value={textDraft}
              onChange={(event) => setTextDraft(event.target.value)}
              autoGrow
              maxRows={16}
              autoFocus
              className={styles.textarea}
            />
            <div className={styles.editorActions}>
              <Button variant="ghost" size="sm" onClick={() => setEditingText(false)}>
                {t('Cancel', undefined, 'edit')}
              </Button>
              <Button variant="primary" size="sm" onClick={() => void saveText()}>
                {t('Save')}
              </Button>
            </div>
          </div>
        ) : text.trim() === '' ? (
          <div className={styles.emptyText}>
            <p>{t('No text yet.')}</p>
            <Button variant="secondary" size="sm" iconStart="edit" onClick={startEditText}>
              {t('Add text')}
            </Button>
          </div>
        ) : (
          <div className={styles.transcript}>
            <TranscriptView
              ref={transcriptRef}
              text={text}
              quotes={quotes}
              info={info}
              current={currentPhrase}
              selectedId={selectedId}
              flashId={flash?.kind === 'quote' ? flash.id : null}
              onQuoteClick={showObject}
            />
            {offscreen ? (
              <button type="button" className={styles.toCurrent} onClick={() => scrollTo(transcriptRef.current?.querySelector('[data-current]'))}>
                {t('Back to the current one')}
              </button>
            ) : null}
          </div>
        )}
      </section>

      {/* ───── objects */}
      <section className={styles.block} aria-labelledby="entry-objects">
        <div className={styles.blockHead}>
          <Label id="entry-objects">{t('What was found{v}', { v: shown.length > 0 ? ` · ${shown.length}` : '' })}</Label>
          {proposedCount > 1 ? (
            <Button variant="ghost" size="sm" onClick={() => void itemsRepo.acceptAll(capture.id)}>
              {t('Accept all')}
            </Button>
          ) : null}
        </div>

        {shown.length === 0 && dismissed.length === 0 ? (
          <p className={styles.quiet}>
            {isInboxStatus(capture.status) ? t('Nothing yet: the record has not been processed.') : t('Nothing was found in this record: no decisions, commitments or ideas.')}
          </p>
        ) : (
          <ol ref={objectsRef} className={styles.objects}>
            {shown.map((item) => (
              <ObjectCard
                key={item.id}
                item={item}
                quoteFound={quoteById.has(item.id)}
                quoteTime={ready && duration > 0 && quoteById.has(item.id) ? formatClock(offsetToSeconds(quoteById.get(item.id)!.start, text.length, duration), { pad: false }) : undefined}
                selected={selectedId === item.id}
                flash={flash?.kind === 'card' && flash.id === item.id}
                busy={busyItems.has(item.id)}
                onAction={(next) => void onItemAction(item, next)}
                onShowSource={() => showSource(item.id)}
              />
            ))}
          </ol>
        )}

        {dismissed.length > 0 ? (
          <details className={styles.dismissed}>
            <summary>{t('Dismissed · {count}', { count: dismissed.length })}</summary>
            <ol className={styles.objects}>
              {dismissed.map((item) => (
                <ObjectCard
                  key={item.id}
                  item={item}
                  quoteFound={false}
                  busy={busyItems.has(item.id)}
                  onAction={(next) => void onItemAction(item, next)}
                  onShowSource={() => undefined}
                />
              ))}
            </ol>
          </details>
        ) : null}

        {proposedCount > 0 ? (
          <Link to={`/review/${capture.id}`} className={styles.reviewLink}>
            {t('Open the review')}
            <Icon name="chevron-right" size={18} />
          </Link>
        ) : null}
      </section>

      {/* ───── actions */}
      <footer className={styles.footer}>
        <Button variant="secondary" size="sm" iconStart="import" loading={processingBusy} onClick={() => setConfirmReprocess(true)}>
          {t('Run processing again')}
        </Button>
        <Button variant="ghost" size="sm" iconStart="trash" onClick={() => void removeCapture()}>
          {t('Delete the record')}
        </Button>
      </footer>

      <ConfirmDialog
        open={confirmReprocess}
        title={t('Reprocess?')}
        message={t('The AI will read the text again. Objects you have not accepted yet will be replaced by new ones; accepted, edited and dismissed ones stay.')}
        confirmLabel={t('Reprocess')}
        onCancel={() => setConfirmReprocess(false)}
        onConfirm={() => {
          setConfirmReprocess(false);
          void reprocess();
        }}
      />
    </article>
  );
}
