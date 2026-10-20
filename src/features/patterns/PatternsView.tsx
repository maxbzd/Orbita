import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { checkAiReadiness, createLlmProvider, findPatterns } from '../../ai';
import { capturesRepo, getSettings, patternsRepo } from '../../db';
import type { Pattern, PatternStatus } from '../../domain/types';
import { Body, Button, Caption, Chip, EmptyState, RECORD_PATH, Skeleton, useToast } from '../../ui';
import { PatternCard } from './PatternCard';
import { FILTER_LABELS, PATTERN_FILTERS, PATTERN_MIN_RECORDS, inFilter, recomputeError, recomputeMessage, sortForDisplay, statusMessage } from './model';
import type { PatternFilter } from './model';
import styles from './Patterns.module.css';
import { t } from '../../i18n';

async function loadPatterns() {
  const [patterns, recent, settings] = await Promise.all([patternsRepo.list(), capturesRepo.list({ limit: PATTERN_MIN_RECORDS }), getSettings()]);
  const ai = settings.ai.provider === 'manual'
    ? { ready: false as const, reason: t('Recalculation does not work in “via clipboard” mode. Pick a provider with a key in Settings → AI.') }
    : checkAiReadiness(settings);
  return { patterns, records: recent.length, settings, ai };
}

/** «Орбита → Паттерны» (SPEC §4.10): constellation cards with proof, «Да, это про меня / Нет», recompute on demand. */
export function PatternsView() {
  const navigate = useNavigate();
  const toast = useToast();
  const data = useLiveQuery(loadPatterns, []);
  const [filter, setFilter] = useState<PatternFilter>('current');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [recomputing, setRecomputing] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const counts = useMemo(() => Object.fromEntries(PATTERN_FILTERS.map((f) => [f, (data?.patterns ?? []).filter((p) => inFilter(p, f)).length])) as Record<PatternFilter, number>, [data]);
  const shown = useMemo(() => sortForDisplay((data?.patterns ?? []).filter((p) => inFilter(p, filter))), [data, filter]);

  if (!data) {
    return (
      <div aria-busy="true" className={styles.loading}>
        <Skeleton shape="block" height={260} label={t('Loading')} />
      </div>
    );
  }

  const setStatus = async (pattern: Pattern, status: PatternStatus): Promise<void> => {
    setBusyId(pattern.id);
    try {
      await patternsRepo.setStatus(pattern.id, status);
      const before = pattern.status;
      toast.show({ message: statusMessage(status), onAction: () => void patternsRepo.setStatus(pattern.id, before), actionLabel: t('Restore') });
    } finally {
      setBusyId(null);
    }
  };

  const recompute = async (): Promise<void> => {
    if (!data.ai.ready) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setRecomputing(true);
    try {
      const found = await findPatterns({ llm: createLlmProvider(data.settings), signal: controller.signal });
      toast.show({ message: recomputeMessage({ created: found.created.length, updated: found.updated.length, notEnoughData: found.reason === 'not-enough-data' }) });
    } catch (error) {
      if (!controller.signal.aborted) toast.show({ message: recomputeError(error), tone: 'danger' });
    } finally {
      if (abort.current === controller) abort.current = null;
      setRecomputing(false);
    }
  };

  const tooFew = data.patterns.length === 0 && data.records < PATTERN_MIN_RECORDS;

  return (
    <div className={styles.view}>
      {tooFew ? (
        <EmptyState
          illustration="ring"
          progress={{ value: data.records, total: PATTERN_MIN_RECORDS }}
          title={t('Patterns appear after {PATTERN_MIN_RECORDS} records. You have {records} now.', { PATTERN_MIN_RECORDS, records: data.records })}
          description={t('They are based only on your records: what repeats and what to do about it.')}
          action={
            <Button variant="primary" iconStart="mic" onClick={() => navigate(RECORD_PATH)}>
              {t('Record', undefined, 'patterns-view')}
            </Button>
          }
        />
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.chips} role="group" aria-label={t('Pattern status')}>
              {PATTERN_FILTERS.map((value) => (
                <Chip key={value} selected={filter === value} count={counts[value]} onClick={() => setFilter(value)}>
                  {FILTER_LABELS[value]}
                </Chip>
              ))}
            </div>
            <Button variant="ai" size="sm" loading={recomputing} disabled={!data.ai.ready} onClick={() => void recompute()}>
              {t('Recalculate')}
            </Button>
          </div>

          {!data.ai.ready ? (
            <div className={styles.notice} role="note">
              <Body tone="muted">{data.ai.reason}</Body>
              <Button variant="secondary" size="sm" onClick={() => navigate('/settings')}>
                {t('Open settings')}
              </Button>
            </div>
          ) : null}

          {shown.length === 0 ? (
            <EmptyState
              illustration="constellation"
              compact
              title={filter === 'current' ? t('No patterns to review yet.') : filter === 'resolved' ? t('No resolved patterns.') : t('No dismissed patterns.')}
              description={filter === 'current' ? t('Press “Recalculate”: I will look through the last few weeks of records and tell you what repeats.') : undefined}
            />
          ) : (
            <ul className={styles.list} aria-label={FILTER_LABELS[filter]}>
              {shown.map((pattern) => (
                <li key={pattern.id}>
                  <PatternCard pattern={pattern} busy={busyId === pattern.id} onStatus={(p, s) => void setStatus(p, s)} />
                </li>
              ))}
            </ul>
          )}
          <Caption tone="faint">{t('AI can be wrong. Check it: you decide whether it is a pattern.')}</Caption>
        </>
      )}
    </div>
  );
}
