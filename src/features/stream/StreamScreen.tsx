import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { ID, ItemKind } from '../../domain/types';
import { Button, Chip, Display, EmptyState, Heading, Label, Skeleton, TYPE_LABELS_PLURAL, useToast } from '../../ui';
import { CaptureRow } from './CaptureRow';
import { FilterSheet } from './FilterSheet';
import { SearchBar } from './SearchBar';
import type { SearchMode } from './SearchBar';
import { SearchResults, captureOfItems } from './SearchResults';
import { STREAM_TYPE_CHIPS, countSheetFilters, filtersToParams, hasAnyFilter, parseFilters, periodFromDay } from './filters';
import type { StreamFilters } from './filters';
import { useStreamData, useToday } from './hooks';
import { runProcessing, outcomeMessage } from './processing';
import { INBOX_ACTION_LABELS, inboxAction } from './rowModel';
import { VIRTUALIZE_FROM, buildStreamRows, estimateRowHeight } from './rows';
import type { StreamRow } from './rows';
import { useDebounced, useSearchHits } from './searchHooks';
import { useWindowVirtualizer } from './virtual';
import type { Capture } from '../../domain/types';
import styles from './StreamScreen.module.css';
import { t } from '../../i18n';

const PAGE_SIZE = 120;
const LOAD_AHEAD_PX = 900;

/** Loads the next page when the end of the list is within reach (scrolling, resizing, and after every render). */
function useLoadMore(sentinel: React.RefObject<HTMLElement>, enabled: boolean, onMore: () => void): void {
  const latest = useRef(onMore);
  latest.current = onMore;
  useEffect(() => {
    if (!enabled) return undefined;
    const check = (): void => {
      const el = sentinel.current;
      if (el && el.getBoundingClientRect().top < window.innerHeight + LOAD_AHEAD_PX) latest.current();
    };
    check();
    window.addEventListener('scroll', check, { passive: true });
    window.addEventListener('resize', check);
    return () => {
      window.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  });
}

/** «Поток»: search or ask, type chips, the unsorted records on top, then days split into morning / day / evening. */
export default function StreamScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const paramsKey = params.toString();
  const filters = useMemo(() => parseFilters(new URLSearchParams(paramsKey)), [paramsKey]);
  const setFilters = useCallback(
    (next: StreamFilters) => setParams((current) => filtersToParams(next, current), { replace: true }),
    [setParams],
  );

  const [mode, setMode] = useState<SearchMode>('find');
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState<ReadonlySet<ID>>(new Set());

  const data = useStreamData(filters, limit);
  const searching = mode === 'find' && query.trim() !== '';
  const debouncedQuery = useDebounced(query);
  const searchFilters = useMemo(
    () => ({ fromDay: periodFromDay(filters.period, today), personId: filters.personId, projectId: filters.projectId }),
    [filters.period, filters.personId, filters.projectId, today],
  );
  const search = useSearchHits(searching ? debouncedQuery : '', searchFilters, filters.type, data.itemsByCapture);
  const captureOfItem = useMemo(() => captureOfItems(data.itemsByCapture), [data.itemsByCapture]);

  // ───── the list
  const rows = useMemo(() => buildStreamRows(data.groups, today), [data.groups, today]);
  const keys = useMemo(() => rows.map((row) => row.key), [rows]);
  const estimate = useCallback((index: number) => (rows[index] ? estimateRowHeight(rows[index]) : 100), [rows]);
  const virtualize = rows.length > VIRTUALIZE_FROM;
  const virtual = useWindowVirtualizer(keys, estimate, virtualize);
  const visibleRows = virtualize ? rows.slice(virtual.window.start, virtual.window.end) : rows;

  const sentinel = useRef<HTMLDivElement>(null);
  useLoadMore(sentinel, !searching && !data.loading && data.hasMore, () => setLimit((current) => current + PAGE_SIZE));

  // ───── the inbox
  const runInboxAction = useCallback(
    async (capture: Capture) => {
      const action = inboxAction(capture.status);
      if (action === 'review') {
        navigate(`/review/${capture.id}`);
        return;
      }
      if (action !== 'process' && action !== 'retry') return;
      setBusy((current) => new Set(current).add(capture.id));
      const result = await runProcessing(capture.id);
      setBusy((current) => {
        const next = new Set(current);
        next.delete(capture.id);
        return next;
      });
      if (!result.ok) {
        toast.show({ message: result.message, tone: 'danger', duration: 8000 });
      } else if (result.outcome === 'review') {
        toast.show({ message: outcomeMessage(result.outcome), actionLabel: t('Open', undefined, 'stream-screen'), onAction: () => navigate(`/review/${capture.id}`), tone: 'ok' });
      } else {
        toast.show({ message: outcomeMessage(result.outcome) });
      }
    },
    [navigate, toast],
  );

  const inboxActionFor = (capture: Capture) => {
    const action = inboxAction(capture.status);
    if (!action) return null;
    if (action === 'busy') {
      return <span className={styles.working}>{t('Processing')}</span>;
    }
    const label = INBOX_ACTION_LABELS[action];
    return (
      <Button
        variant={action === 'retry' ? 'secondary' : 'primary'}
        size="sm"
        loading={busy.has(capture.id)}
        onClick={() => void runInboxAction(capture)}
        aria-label={`${label}: ${capture.title ?? t('record', undefined, 'stream-screen')}`}
      >
        {label}
      </Button>
    );
  };

  const renderRow = (row: StreamRow) => {
    switch (row.type) {
      case 'day':
        return (
          <div className={styles.dayHead}>
            <h2 className={styles.dayTitle}>{row.heading.title}</h2>
            {row.heading.subtitle ? <span className={styles.daySub}>{row.heading.subtitle}</span> : null}
          </div>
        );
      case 'part':
        return <div className={styles.partHead}>{row.label}</div>;
      case 'capture':
        return (
          <CaptureRow
            capture={row.capture}
            items={data.itemsByCapture.get(row.capture.id)}
            mood={data.moodByCapture.get(row.capture.id)}
          />
        );
    }
  };

  const typeChip = (type: ItemKind | undefined, label: string) => (
    <Chip
      key={type ?? 'all'}
      type={type}
      selected={filters.type === type}
      onClick={() => setFilters({ ...filters, type })}
    >
      {label}
    </Chip>
  );
  const sheetCount = countSheetFilters(filters);
  const anyFilter = hasAnyFilter(filters);
  const nothingAtAll = data.empty && !anyFilter;

  return (
    <section className={styles.screen} aria-labelledby="stream-title">
      <header className={styles.header}>
        <Display as="h1" size="l" id="stream-title">
          {t('Stream')}
        </Display>
      </header>

      <SearchBar
        mode={mode}
        onModeChange={setMode}
        value={query}
        onChange={setQuery}
        onAsk={(question) => navigate(`/ask?q=${encodeURIComponent(question)}`)}
      />

      <div className={styles.chipRow} role="group" aria-label={t('Object type', undefined, 'stream-screen')}>
        {typeChip(undefined, t('All'))}
        {STREAM_TYPE_CHIPS.map((kind) => typeChip(kind, TYPE_LABELS_PLURAL[kind]))}
        <span className={styles.chipDivider} aria-hidden="true" />
        <Chip selected={sheetCount > 0} count={sheetCount > 0 ? sheetCount : undefined} onClick={() => setSheetOpen(true)} aria-haspopup="dialog">
          {t('Filters')}
        </Chip>
      </div>

      {searching ? (
        <div className={styles.results} aria-live="polite">
          {!search.ready ? (
            <Skeleton shape="block" height={72} label={t('Searching')} />
          ) : search.failed ? (
            <EmptyState illustration="none" title={t('Search is unavailable right now.')} description={t('Your records are intact, try reopening the screen.')} />
          ) : search.hits.length === 0 ? (
            <EmptyState
              title={t('Nothing found for “{v}”.', { v: query.trim() })}
              description={anyFilter ? t('Try removing the filters or asking the assistant.') : t('Try another word or ask the assistant.')}
              action={
                <div className={styles.emptyActions}>
                  {anyFilter ? (
                    <Button variant="ghost" size="sm" onClick={() => setFilters({ period: 'all' })}>
                      {t('Remove filters')}
                    </Button>
                  ) : null}
                  <Button variant="secondary" size="sm" onClick={() => setMode('ask')}>
                    {t('Ask')}
                  </Button>
                </div>
              }
            />
          ) : (
            <SearchResults hits={search.hits} captureOfItem={captureOfItem} />
          )}
        </div>
      ) : data.loading ? (
        <div className={styles.skeletons} aria-busy="true">
          <Skeleton shape="block" height={96} label={t('Loading records')} />
          <Skeleton shape="block" height={96} />
          <Skeleton shape="block" height={96} />
        </div>
      ) : nothingAtAll ? (
        <EmptyState
          title={t('Your records will be here. Start with one phrase.')}
          action={
            <Button variant="primary" iconStart="mic" onClick={() => navigate('/capture?autostart=1')}>
              {t('Record', undefined, 'stream-screen')}
            </Button>
          }
        />
      ) : data.empty ? (
        <EmptyState
          illustration="none"
          title={t('No records match these filters.')}
          action={
            <Button variant="secondary" size="sm" onClick={() => setFilters({ period: 'all' })}>
              {t('Reset filters')}
            </Button>
          }
        />
      ) : (
        <>
          {data.inbox.length > 0 ? (
            <section className={styles.inbox} aria-labelledby="stream-inbox">
              <div className={styles.inboxHead}>
                <Label id="stream-inbox">{t('Unprocessed')}</Label>
                <span className={styles.inboxCount}>{data.inbox.length}</span>
              </div>
              <div className={styles.inboxList}>
                {data.inbox.map((capture) => (
                  <CaptureRow
                    key={capture.id}
                    capture={capture}
                    items={data.itemsByCapture.get(capture.id)}
                    mood={data.moodByCapture.get(capture.id)}
                    showStatus
                    action={inboxActionFor(capture)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {rows.length > 0 ? (
            <div
              ref={virtual.containerRef}
              className={styles.list}
              style={virtualize ? { paddingTop: virtual.window.before, paddingBottom: virtual.window.after } : undefined}
              data-virtual={virtualize || undefined}
              data-testid="stream-list"
            >
              {visibleRows.map((row) => (
                <div key={row.key} ref={virtualize ? virtual.measure(row.key) : undefined} className={styles.rowBox} data-row={row.type}>
                  {renderRow(row)}
                </div>
              ))}
            </div>
          ) : (
            <Heading as="p" variant="headline" className={styles.onlyInbox}>
              {t('No other records yet.')}
            </Heading>
          )}

          <div ref={sentinel} className={styles.sentinel} aria-hidden="true" />
          {data.hasMore && typeof IntersectionObserver === 'undefined' ? (
            <Button variant="ghost" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
              {t('Show more')}
            </Button>
          ) : null}
        </>
      )}

      <FilterSheet open={sheetOpen} onClose={() => setSheetOpen(false)} filters={filters} onChange={setFilters} people={data.people} projects={data.projects} />
    </section>
  );
}
