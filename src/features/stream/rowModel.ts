import { formatDuration, formatTime } from '../../domain/dates';
import { truncate } from '../../domain/text';
import type { Capture, CaptureKind, ID, Item, ItemKind, ProcessStatus } from '../../domain/types';
import { t } from '../../i18n';

export const CAPTURE_KIND_LABELS: Record<CaptureKind, string> = {
  get voice() { return t('Voice') },
  get text() { return t('Text') },
  get ai_chat() { return t('Chat with the AI') },
  get checkin() { return t('State') },
  get review_answer() { return t('Reply to a review') },
};

/** The statuses of records that still wait for something (the "неразобранные" at the top of the stream). */
export const WORKING_STATUSES: readonly ProcessStatus[] = ['transcribing', 'extracting'];

export type InboxAction = 'process' | 'retry' | 'review' | 'busy';

/** What the inbox offers for a record: run the pipeline, retry after an error, open the review, or just wait. */
export function inboxAction(status: ProcessStatus): InboxAction | null {
  switch (status) {
    case 'raw':
    case 'transcribed':
      return 'process';
    case 'failed':
      return 'retry';
    case 'review':
      return 'review';
    case 'transcribing':
    case 'extracting':
      return 'busy';
    default:
      return null;
  }
}

export const INBOX_ACTION_LABELS: Record<Exclude<InboxAction, 'busy'>, string> = {
  get process() { return t('Review', undefined, 'inbox') },
  get retry() { return t('Try again') },
  get review() { return t('Review', undefined, 'inbox') },
};

/** Short status text for the row; empty for finished records. */
export function statusLabel(status: ProcessStatus): string | undefined {
  switch (status) {
    case 'raw':
      return t('Not processed');
    case 'transcribing':
      return t('Transcribing…');
    case 'transcribed':
      return t('Waiting for processing');
    case 'extracting':
      return t('Pulling out objects…');
    case 'review':
      return t('Waiting for confirmation');
    case 'failed':
      return t('Could not process');
    default:
      return undefined;
  }
}

export function isInboxStatus(status: ProcessStatus): boolean {
  return inboxAction(status) !== null;
}

const TITLE_MAX = 70;
const EXCERPT_MAX = 160;

const firstLine = (text: string): string => text.split('\n').find((line) => line.trim() !== '')?.trim() ?? '';

/** The title as the user sees it: the stored one, else the first line of the text, else a word for the kind. */
export function captureTitle(capture: Pick<Capture, 'title' | 'text' | 'kind'>): string {
  const stored = capture.title?.trim();
  if (stored) return stored;
  const line = firstLine(capture.text);
  if (line) return truncate(line, TITLE_MAX);
  return capture.kind === 'voice' ? t('Voice recording') : t('Record without text');
}

/** Two lines under the title: the summary, else the beginning of the text (unless the title already is that). */
export function captureSummary(capture: Pick<Capture, 'title' | 'summary' | 'text'>): string | undefined {
  const summary = capture.summary?.trim();
  if (summary) return summary;
  if (!capture.title?.trim()) return undefined;
  const text = capture.text.replace(/\s+/g, ' ').trim();
  return text ? truncate(text, EXCERPT_MAX) : undefined;
}

export interface ObjectChip {
  id: ID;
  kind: ItemKind;
  title: string;
  /** Waits for the user's decision: marked with a dot. */
  proposed: boolean;
}

export const MAX_ROW_CHIPS = 3;
const CHIP_TITLE_MAX = 24;

/** Chips of the objects extracted from a record: proposed first (they need attention), then in extraction order. */
export function objectChips(items: readonly Item[] = [], max: number = MAX_ROW_CHIPS): { chips: ObjectChip[]; more: number } {
  const ordered = [...items].sort((a, b) => Number(b.status === 'proposed') - Number(a.status === 'proposed'));
  const chips = ordered.slice(0, max).map((item) => ({
    id: item.id,
    kind: item.kind,
    title: truncate(item.title, CHIP_TITLE_MAX),
    proposed: item.status === 'proposed',
  }));
  return { chips, more: Math.max(0, ordered.length - chips.length) };
}

export function pendingCount(items: readonly Item[] = []): number {
  return items.filter((item) => item.status === 'proposed').length;
}

/** "14:05 · 1 мин 12 с" */
export function rowMeta(capture: Pick<Capture, 'createdAt' | 'durationSec' | 'kind'>): string {
  const parts = [formatTime(capture.createdAt)];
  if (capture.durationSec && capture.durationSec > 0) parts.push(formatDuration(capture.durationSec));
  return parts.join(' · ');
}

// ───────── The decorative capsule ─────────

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A stand-in for the real peaks in a list row: decoding every recording of a long stream would cost far
 * more than a 24-bar capsule is worth. The same record always gets the same picture.
 */
export function decorativePeaks(seed: string, count = 24): number[] {
  let state = hash(seed) || 1;
  const next = (): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
  return Array.from({ length: count }, (_, i) => {
    const envelope = 0.55 + 0.45 * Math.sin((i / Math.max(1, count - 1)) * Math.PI);
    return Math.min(1, Math.max(0.12, (0.25 + next() * 0.75) * envelope));
  });
}
