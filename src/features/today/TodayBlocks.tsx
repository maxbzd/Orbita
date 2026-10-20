import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { t, tn } from '../../i18n';
import { patternsRepo } from '../../db';
import { formatDayShort } from '../../domain';
import { timesCount } from '../../domain/counts';
import type { Pattern, Review } from '../../domain/types';
import { Body, Button, Caption, Heading, Label, ListRow, MoodFlower, ProgressRing, Thought, TypeMedallion, moodHex, moodWord, useToast } from '../../ui';
import type { BurningRow, TodayModel } from './model';
import { PATTERN_THRESHOLD } from './snapshot';
import styles from './Today.module.css';

/** The destination of a metric or a row: the list of its kind. */
const listPath = (kind: BurningRow['kind']): string => `/items/${kind}`;

// ───────── Metric chips ─────────

interface MetricProps {
  label: string;
  value: ReactNode;
  to?: string;
  tint?: string;
}

function Metric({ label, value, to, tint }: MetricProps) {
  const content = (
    <>
      <span className={styles.metricValue}>
        {tint ? <span className={styles.metricDot} style={{ background: tint }} aria-hidden="true" /> : null}
        {value}
      </span>
      <span className={styles.metricLabel}>{label}</span>
    </>
  );
  return to ? (
    <Link to={to} className={styles.metric}>
      {content}
    </Link>
  ) : (
    <span className={styles.metric}>{content}</span>
  );
}

/** Up to four round-ish chips under the hero: state, records, what burns, people. */
export function MetricChips({ model }: { model: TodayModel }) {
  return (
    <div className={styles.metrics} role="group" aria-label={t('Summary of the day', undefined, 'today-blocks')}>
      <Metric label={t('State')} value={model.moodLabel ?? t('Not logged')} to="/checkin" tint={model.mood === null ? undefined : moodHex(model.mood)} />
      <Metric label={t('Records', undefined, 'today-blocks')} value={model.counts.captures} to="/stream" />
      <Metric label={t('Burning')} value={model.burningCount} />
      <Metric label={t('People')} value={model.peopleCount} to="/people" />
    </div>
  );
}

// ───────── Burning today ─────────

export function BurningBlock({ model }: { model: TodayModel }) {
  const navigate = useNavigate();
  const hidden = model.burningCount - model.burning.length;
  return (
    <section className={styles.block} aria-labelledby="today-burning">
      <Label as="h2" id="today-burning" className={styles.blockLabel}>
        {t('Burning today')}
      </Label>
      {model.burning.length === 0 ? (
        <Body tone="muted" className={styles.quiet}>
          {t('Nothing is burning. You can breathe out.')}
        </Body>
      ) : (
        <ul className={styles.rows}>
          {model.burning.map((row) => (
            <ListRow
              key={row.id}
              as="li"
              leading={<TypeMedallion kind={row.kind} size={36} />}
              title={row.title}
              subtitle={
                <>
                  {row.subtitle} · <span className={row.overdue ? styles.late : undefined}>{row.meta}</span>
                </>
              }
              onClick={() => navigate(listPath(row.kind))}
            />
          ))}
        </ul>
      )}
      {hidden > 0 ? (
        <Link to={listPath(model.burning[0]?.kind ?? 'commitment')} className={styles.more}>
          
          {t('{hidden} more of {burningCount}', { hidden, burningCount: model.burningCount })}
        </Link>
      ) : null}
    </section>
  );
}

// ───────── What I noticed ─────────

function patternMeta(pattern: Pattern): string {
  const times = timesCount(pattern.occurrences);
  return t('{times} · last {formatDayShort}', { times, formatDayShort: formatDayShort(pattern.lastSeenDay) });
}

export function InsightBlock({ pattern, review, recordsTotal }: { pattern: Pattern | null; review: Review | null; recordsTotal: number }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const setStatus = async (next: Pattern['status'], message: string): Promise<void> => {
    if (!pattern || busy) return;
    const previous = pattern.status;
    setBusy(true);
    try {
      await patternsRepo.update(pattern.id, { status: next });
      toast.show({
        message,
        actionLabel: t('Restore'),
        onAction: () => void patternsRepo.update(pattern.id, { status: previous }),
      });
    } finally {
      setBusy(false);
    }
  };

  let body: ReactNode;
  if (pattern) {
    const candidate = pattern.status === 'candidate';
    body = (
      <>
        <Thought className={styles.insightText}>{pattern.title}</Thought>
        <Caption>{candidate ? t('Pattern candidate') : t('Confirmed pattern')} · {patternMeta(pattern)}</Caption>
        <div className={styles.insightActions}>
          {candidate ? (
            <>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void setStatus('confirmed', t('Pattern accepted.'))}>
                {t("Yes, that's me", undefined, 'today-blocks')}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setStatus('rejected', t("I won't show this pattern again."))}>
                {t('No')}
              </Button>
            </>
          ) : (
            <>
              <Link to="/patterns" className={styles.inlineLink}>
                {t('All patterns')}
              </Link>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void setStatus('resolved', t('Marked as closed.'))}>
                {t('Closed', undefined, 'today-blocks')}
              </Button>
            </>
          )}
        </div>
      </>
    );
  } else if (review) {
    body = (
      <>
        <Thought className={styles.insightText}>{review.headline}</Thought>
        <Caption>{review.generatedBy === 'ai' ? t('From the review') : t('Summary of your records')} · {formatDayShort(review.endDay)}</Caption>
        <div className={styles.insightActions}>
          <Link to={`/reviews/${review.id}`} className={styles.inlineLink}>
            {t('Open the review', undefined, 'today-blocks')}
          </Link>
        </div>
      </>
    );
  } else {
    body = (
      <div className={styles.insightEmpty}>
        <ProgressRing value={Math.min(1, recordsTotal / PATTERN_THRESHOLD)} size={48} label={t('Records until the first patterns')} valueText={t('{recordsTotal} of {PATTERN_THRESHOLD}', { recordsTotal, PATTERN_THRESHOLD })}>
          <span className={styles.ringNumber}>{recordsTotal}</span>
        </ProgressRing>
        <Body tone="muted">
          
          {t('Patterns appear after {PATTERN_THRESHOLD} records. You have {recordsTotal} now.', { PATTERN_THRESHOLD, recordsTotal })}
        
        </Body>
      </div>
    );
  }

  return (
    <section className={styles.insight} aria-labelledby="today-insight" data-empty={!pattern && !review ? '' : undefined}>
      <Label as="h2" id="today-insight" className={styles.blockLabel}>
        {t('What I noticed')}
      </Label>
      {body}
      <Caption tone="faint" className={styles.disclaimer}>
        {t('AI can be wrong. Check it.')}
      </Caption>
    </section>
  );
}

// ───────── How are you ─────────

export function CheckInRow({ model }: { model: TodayModel }) {
  const navigate = useNavigate();
  const latest = model.latestCheckIn;
  const suggested = model.suggested.length;
  const title = latest ? t('Now: {toLowerCase}', { toLowerCase: moodWord(latest.valence * 3).toLowerCase() }) : t('How are you?');
  const subtitle =
    suggested > 0
      ? tn(suggested, 'The AI noticed a mood check-in in your records. Confirm?', 'The AI noticed mood check-ins in your records. Confirm?')
      : latest
        ? t('Update your state')
        : t('Log your state in ten seconds');
  return (
    <section className={styles.block} aria-label={t('State')}>
      <ListRow
        className={styles.checkinRow}
        leading={latest ? <MoodFlower value={latest.valence * 3} size={28} decorative /> : <MoodFlower value={0} size={28} decorative />}
        title={title}
        subtitle={subtitle}
        onClick={() => navigate('/checkin')}
      />
    </section>
  );
}

// ───────── Close the day ─────────

export interface CloseDayCardProps {
  model: TodayModel;
  reviewId: string | null;
  busy: boolean;
  onClose: () => void;
}

/** Evening card: what the day already holds, as result rows, and the one action. */
export function CloseDayCard({ model, reviewId, busy, onClose }: CloseDayCardProps) {
  const navigate = useNavigate();
  const rows: Array<{ text: string; done: boolean }> = [
    { text: model.moodLabel ? t('State: {toLowerCase}', { toLowerCase: model.moodLabel.toLowerCase() }) : t('State not logged'), done: model.moodLabel !== null },
    { text: model.counts.captures > 0 ? t('Records today: {captures}', { captures: model.counts.captures }) : t('No records today'), done: model.counts.captures > 0 },
    { text: model.burningCount > 0 ? t('Still burning: {burningCount}', { burningCount: model.burningCount }) : t('Nothing is burning'), done: model.burningCount === 0 },
  ];
  return (
    <section className={styles.closeCard} aria-labelledby="today-close">
      <Heading as="h2" variant="headline" id="today-close">
        {reviewId ? t('Day closed') : t('Close the day')}
      </Heading>
      <ul className={styles.resultRows}>
        {rows.map((row) => (
          <li key={row.text} className={styles.resultRow} data-done={row.done ? '' : undefined}>
            <span className={styles.tick} aria-hidden="true" />
            {row.text}
          </li>
        ))}
      </ul>
      {reviewId ? (
        <Button size="md" variant="secondary" fullWidth onClick={() => navigate(`/reviews/${reviewId}`)}>
          {t('Open the day summary')}
        </Button>
      ) : (
        <Button size="md" variant="primary" fullWidth loading={busy} onClick={onClose}>
          {t('Close the day')}
        </Button>
      )}
    </section>
  );
}
