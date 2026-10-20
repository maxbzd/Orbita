import { isAiError } from '../../ai/errors';
import { formatDayShort } from '../../domain/dates';
import { timesCount } from '../../domain/counts';
import { t } from '../../i18n';
import type { Pattern, PatternEvidence, PatternStatus } from '../../domain/types';
import type { ConstellationEdge, ConstellationNode } from '../../ui';

/** Records needed before patterns can appear («Паттерны появятся после 14 записей. Сейчас 6.»). */
export const PATTERN_MIN_RECORDS = 14;

export const STATUS_LABELS: Record<PatternStatus, string> = {
  get candidate() { return t('Candidate') },
  get confirmed() { return t('Confirmed') },
  get rejected() { return t('Dismissed', undefined, 'pattern') },
  get resolved() { return t('Resolved', undefined, 'pattern') },
};

/** The filter chips: what is current, what is solved, what was dismissed. */
export const PATTERN_FILTERS = ['current', 'resolved', 'rejected'] as const;
export type PatternFilter = (typeof PATTERN_FILTERS)[number];
export const FILTER_LABELS: Record<PatternFilter, string> = { get current() { return t('Current') }, get resolved() { return t('Resolved', undefined, 'filter') }, get rejected() { return t('Dismissed', undefined, 'filter') } };

export function inFilter(pattern: Pick<Pattern, 'status'>, filter: PatternFilter): boolean {
  if (filter === 'current') return pattern.status === 'candidate' || pattern.status === 'confirmed';
  return pattern.status === filter;
}

/** Confirmed first, then by confidence; the repository already orders by recency. */
export function sortForDisplay(patterns: readonly Pattern[]): Pattern[] {
  const rank = (p: Pattern): number => (p.status === 'confirmed' ? 0 : 1);
  return [...patterns].sort((a, b) => rank(a) - rank(b) || b.lastSeenDay.localeCompare(a.lastSeenDay) || b.confidence - a.confidence);
}

export interface StatusAction {
  to: PatternStatus;
  label: string;
  /** primary: «Да, это про меня». */
  tone: 'primary' | 'secondary' | 'ghost';
}

/** What the user can do with a pattern in each status. */
export function actionsFor(status: PatternStatus): StatusAction[] {
  switch (status) {
    case 'candidate':
      return [
        { to: 'confirmed', label: t("Yes, that's me"), tone: 'primary' },
        { to: 'rejected', label: t('No'), tone: 'secondary' },
      ];
    case 'confirmed':
      return [
        { to: 'resolved', label: t('Not relevant anymore'), tone: 'secondary' },
        { to: 'candidate', label: t('Not sure'), tone: 'ghost' },
      ];
    case 'resolved':
      return [{ to: 'confirmed', label: t('Relevant again'), tone: 'secondary' }];
    case 'rejected':
      return [{ to: 'candidate', label: t('Put back for review'), tone: 'secondary' }];
  }
}

/** Toast after a status change. */
export function statusMessage(status: PatternStatus): string {
  switch (status) {
    case 'confirmed':
      return t('Noted: this is about you.');
    case 'rejected':
      return t("Okay, I won't show it again.");
    case 'resolved':
      return t('Marked as resolved.');
    case 'candidate':
      return t('Put back for review.');
  }
}

/** Confidence in words and percent, for text and screen readers. */
export function confidenceLabel(confidence: number): string {
  const percent = Math.round(Math.min(1, Math.max(0, confidence)) * 100);
  const word = confidence >= 0.7 ? t('high') : confidence >= 0.45 ? t('medium') : t('low');
  return t('Confidence {word}, {percent} %', { word, percent });
}

/** Evidence in time order. */
export function sortedEvidence(pattern: Pick<Pattern, 'evidence'>): PatternEvidence[] {
  return [...pattern.evidence].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * The pattern as a constellation: one star per record that shows it, joined in time order.
 * A line is dashed while the pattern is a candidate and solid once it is confirmed.
 */
export function constellationOf(pattern: Pick<Pattern, 'evidence' | 'status'>): { nodes: ConstellationNode[]; edges: ConstellationEdge[] } {
  const nodes: ConstellationNode[] = [];
  const seen = new Set<string>();
  for (const entry of sortedEvidence(pattern)) {
    if (seen.has(entry.captureId)) continue;
    seen.add(entry.captureId);
    nodes.push({ id: entry.captureId, label: t('Record of {formatDayShort}', { formatDayShort: formatDayShort(entry.day) }), kind: 'pattern' });
  }
  const status = pattern.status === 'confirmed' || pattern.status === 'resolved' ? 'confirmed' : 'candidate';
  const edges: ConstellationEdge[] = nodes.slice(1).map((node, index) => ({ a: nodes[index]!.id, b: node.id, status, reason: t('Records about the same thing') }));
  return { nodes, edges };
}

/** «Повторялось 4 раза: с 3 окт. по 9 окт.» */
export function repeatLine(pattern: Pick<Pattern, 'occurrences' | 'firstSeenDay' | 'lastSeenDay'>): string {
  const times = timesCount(pattern.occurrences);
  if (pattern.firstSeenDay === pattern.lastSeenDay) return t('Noticed: {times}, {formatDayShort}', { times, formatDayShort: formatDayShort(pattern.firstSeenDay) });
  return t('Noticed: {times}, from {formatDayShort} to {formatDayShort2}', { times, formatDayShort: formatDayShort(pattern.firstSeenDay), formatDayShort2: formatDayShort(pattern.lastSeenDay) });
}

export interface RecomputeOutcome {
  created: number;
  updated: number;
  notEnoughData?: boolean;
}

/** One calm sentence for the toast after «Пересчитать». */
export function recomputeMessage(outcome: RecomputeOutcome): string {
  if (outcome.notEnoughData) return t('Too few records to search: you need at least four records on different days over the last weeks.');
  const parts: string[] = [];
  if (outcome.created > 0) parts.push(t('new: {created}', { created: outcome.created }));
  if (outcome.updated > 0) parts.push(t('updated: {updated}', { updated: outcome.updated }));
  return parts.length === 0 ? t('No new patterns found.') : t('Found patterns ({v}). Check whether they are about you.', { v: parts.join(', ') });
}

/** The reason a recompute failed, in Russian and without blame (AI errors already carry a Russian sentence). */
export function recomputeError(error: unknown): string {
  if (isAiError(error)) return error.message;
  return t('Could not recalculate patterns. Your records are safe, try later.');
}
