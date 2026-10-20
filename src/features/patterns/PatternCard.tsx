import { useNavigate } from 'react-router-dom';
import { formatDayShort } from '../../domain/dates';
import type { Pattern, PatternStatus } from '../../domain/types';
import { Body, Button, Caption, Constellation, Heading, InsightStar, Pill, Thought, cx } from '../../ui';
import type { PillTone } from '../../ui';
import { useLinkProps } from '../orbit/useLink';
import { STATUS_LABELS, actionsFor, confidenceLabel, constellationOf, repeatLine, sortedEvidence } from './model';
import styles from './Patterns.module.css';
import { t } from '../../i18n';

const STATUS_TONE: Record<PatternStatus, PillTone> = { candidate: 'warn', confirmed: 'ok', rejected: 'neutral', resolved: 'neutral' };

interface PatternCardProps {
  pattern: Pattern;
  busy?: boolean;
  onStatus(pattern: Pattern, status: PatternStatus): void;
}

/** A pattern as a constellation with its proof: quotes and dates, confidence, the question to the user, a next step. */
export function PatternCard({ pattern, busy, onStatus }: PatternCardProps) {
  const link = useLinkProps();
  const navigate = useNavigate();
  const { nodes, edges } = constellationOf(pattern);
  const evidence = sortedEvidence(pattern);
  const percent = Math.round(pattern.confidence * 100);
  const titleId = `pattern-${pattern.id}`;

  return (
    <article className={cx(styles.card, pattern.status === 'confirmed' && styles.confirmed, (pattern.status === 'rejected' || pattern.status === 'resolved') && styles.muted)} aria-labelledby={titleId}>
      <header className={styles.cardHead}>
        <Pill tone={STATUS_TONE[pattern.status]} dot>
          {STATUS_LABELS[pattern.status]}
        </Pill>
        <Heading as="h2" variant="headline" id={titleId}>
          {pattern.title}
        </Heading>
        {pattern.description ? <Body tone="muted">{pattern.description}</Body> : null}
      </header>

      {nodes.length >= 2 ? (
        <Constellation
          nodes={nodes}
          edges={edges}
          width={300}
          height={170}
          animate={false}
          label={t('Pattern constellation: {count} records. {v}', { count: nodes.length, v: pattern.status === 'candidate' ? t('Dotted line: candidate') : t('Solid line: confirmed') })}
          className={styles.constellation}
          onSelectNode={(id) => navigate(`/entry/${id}`)}
        />
      ) : null}

      <div className={styles.meta}>
        <div className={styles.confidence}>
          <Caption>{confidenceLabel(pattern.confidence)}</Caption>
          <div className={styles.meter} role="meter" aria-label={t('Confidence')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
            <span style={{ width: `${percent}%` }} />
          </div>
        </div>
        <Caption>{repeatLine(pattern)}</Caption>
      </div>

      {pattern.status === 'confirmed' ? (
        <div className={styles.star}>
          <InsightStar phrase={pattern.title} eyebrow={t('CONFIRMED')} caption={t('PATTERN')} maxWidth={180} />
        </div>
      ) : null}

      {evidence.length > 0 ? (
        <details className={styles.evidence} open={pattern.status === 'candidate'}>
          <summary>{t('Evidence · {count}', { count: evidence.length })}</summary>
          <ul className={styles.proofs}>
            {evidence.map((entry, index) => (
              <li key={`${entry.captureId}-${index}`} className={styles.proof}>
                <Caption className={styles.proofDate}>{formatDayShort(entry.day)}</Caption>
                {entry.quote ? <Thought size="sm">«{entry.quote}»</Thought> : <Caption tone="faint">{t('No quote')}</Caption>}
                <a className={styles.proofLink} {...link(`/entry/${entry.captureId}`)}>
                  {t('Open the record')}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <Caption tone="faint">{t('No evidence: the pattern was added without records.')}</Caption>
      )}

      {pattern.suggestion ? (
        <div className={styles.suggestion} role="group" aria-label={t('What to do about it')}>
          <Caption className={styles.suggestionTitle}>{t('What to do about it')}</Caption>
          <Body>{pattern.suggestion}</Body>
        </div>
      ) : null}

      <div className={styles.actions}>
        {actionsFor(pattern.status).map((action) => (
          <Button key={action.to} variant={action.tone} size="sm" disabled={busy} onClick={() => onStatus(pattern, action.to)}>
            {action.label}
          </Button>
        ))}
      </div>
    </article>
  );
}
