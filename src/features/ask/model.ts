import { isAiError } from '../../ai';
import type { AskAnswer, Citation, Msg } from '../../ai';
import type { Item } from '../../domain/types';
import { t } from '../../i18n';

/** The conversation of «Спросить»: types and pure helpers (no React, no network). */

export type TurnStatus = 'thinking' | 'done' | 'error' | 'stopped';

export interface Turn {
  id: number;
  question: string;
  status: TurnStatus;
  /** The answer as it streams in (codes still raw). */
  partial: string;
  answer?: AskAnswer;
  error?: string;
}

/** `[c3]`, `[c3][i7]`, `[c3, i7]` — the codes the model puts in its answer. */
const CODE_GROUP = /\[\s*[a-z]\d{1,3}(?:\s*[,;]\s*[a-z]\d{1,3})*\s*\]/gi;

/**
 * While the answer streams the codes cannot be checked yet (the model may invent one), so they are hidden; the
 * finished answer shows the verified ones as links. A code cut in half by the stream (`[c`) is hidden too.
 */
export function stripCodes(text: string): string {
  return text
    .replace(CODE_GROUP, '')
    .replace(/\[[a-z]?\d{0,3}[\s,;a-z\d]*$/i, '')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

/** What the model remembers of the earlier turns: finished ones only, in order. */
export function historyOf(turns: readonly Turn[]): Msg[] {
  return turns.flatMap((turn): Msg[] =>
    turn.status === 'done' && turn.answer
      ? [
          { role: 'user', content: turn.question },
          { role: 'assistant', content: turn.answer.text },
        ]
      : [],
  );
}

/** Where a link-chip leads. A source item opens inside its capture (at its quote) when the capture is known. */
export function citationPath(citation: Pick<Citation, 'kind' | 'id'>, item?: Pick<Item, 'kind' | 'captureId'> | null): string {
  switch (citation.kind) {
    case 'capture':
      return `/entry/${citation.id}`;
    case 'item':
      return item?.captureId ? `/entry/${item.captureId}?item=${citation.id}` : `/items/${item?.kind ?? 'decision'}`;
    case 'person':
      return `/people/${citation.id}`;
    case 'pattern':
      return '/patterns';
  }
}

export const KIND_LABELS: Record<Citation['kind'], string> = {
  get capture() { return t('Record') },
  get item() { return t('Object') },
  get person() { return t('Person') },
  get pattern() { return t('Pattern') },
};

/** A failed question, in words for the user. */
export function askErrorText(error: unknown): string {
  if (isAiError(error)) return error.message;
  if (error instanceof Error && error.message !== '') return t('Could not get an answer: {message}', { message: error.message });
  return t('Could not get an answer. Please try again.');
}

/** `?q=…` of a deep link ("Спросить" from the search, a notification, a shortcut). */
export function questionFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('q')?.trim();
  return value ? value.slice(0, 500) : null;
}
