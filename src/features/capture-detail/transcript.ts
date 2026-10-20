import type { ID, Item } from '../../domain/types';
import type { AudioMarker } from '../../ui';

/** `[start, end)` offsets into the transcript text. */
export interface TextSpan {
  start: number;
  end: number;
}

export interface LocatedQuote extends TextSpan {
  itemId: ID;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where an object's quote sits in the (possibly since edited) text. The stored offset is trusted only if
 * the text still matches there; otherwise the nearest occurrence wins, then a looser match (case and
 * runs of whitespace ignored). `null`: the quote is no longer in the text, and the screen says so.
 */
export function locateQuote(text: string, quote: string | undefined, quoteStart?: number): TextSpan | null {
  const needle = quote?.trim();
  if (!needle || text === '') return null;

  if (quoteStart !== undefined && Number.isInteger(quoteStart) && quoteStart >= 0 && text.startsWith(needle, quoteStart)) {
    return { start: quoteStart, end: quoteStart + needle.length };
  }
  const hint = quoteStart !== undefined && Number.isFinite(quoteStart) ? quoteStart : 0;

  let best: number | null = null;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    if (best === null || Math.abs(at - hint) < Math.abs(best - hint)) best = at;
  }
  if (best !== null) return { start: best, end: best + needle.length };

  const loose = new RegExp(needle.split(/\s+/).map(escapeRegExp).join('\\s+'), 'iu').exec(text);
  return loose ? { start: loose.index, end: loose.index + loose[0].length } : null;
}

/** The quotes of the objects that can be found in the text, in text order. */
export function locateQuotes(text: string, items: readonly Item[]): LocatedQuote[] {
  const located: LocatedQuote[] = [];
  for (const item of items) {
    const span = locateQuote(text, item.quote, item.quoteStart);
    if (span) located.push({ itemId: item.id, ...span });
  }
  return located.sort((a, b) => a.start - b.start || a.end - b.end);
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Second of the recording a place in the text corresponds to: the share of the text before it times the
 * length. Speech is not uniform, so this is an estimate (good enough to point near a phrase), and the
 * screen never claims word-by-word timing.
 */
export function offsetToSeconds(offset: number, textLength: number, durationSec: number): number {
  if (!(textLength > 0) || !(durationSec > 0)) return 0;
  return clamp01(offset / textLength) * durationSec;
}

/** Inverse of `offsetToSeconds`. */
export function secondsToOffset(seconds: number, textLength: number, durationSec: number): number {
  if (!(durationSec > 0)) return 0;
  return Math.round(clamp01(seconds / durationSec) * textLength);
}

/** Markers of the timeline: one per object whose quote is in the text. */
export function buildMarkers(text: string, items: readonly Item[], durationSec: number): AudioMarker[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return locateQuotes(text, items).flatMap((quote) => {
    const item = byId.get(quote.itemId);
    return item ? [{ id: item.id, time: offsetToSeconds(quote.start, text.length, durationSec), kind: item.kind, label: item.title }] : [];
  });
}

// ───────── Phrases ─────────

const SENTENCE_END = /[.!?…]/;
const CLOSERS = /["'»)\]”’]/;

/**
 * Cuts the text into phrases that together cover all of it: a phrase ends after . ! ? … when whitespace or
 * the end follows (so "14.5" stays whole), or at a line break. Trailing whitespace stays with the phrase.
 */
export function splitSentences(text: string): TextSpan[] {
  const spans: TextSpan[] = [];
  let start = 0;
  let i = 0;
  const push = (end: number): void => {
    if (end <= start) return;
    if (text.slice(start, end).trim() !== '') {
      spans.push({ start, end });
      start = end;
    } else if (spans.length > 0) {
      // Blank lines belong to the phrase before them; at the very start they join the first phrase.
      spans[spans.length - 1]!.end = end;
      start = end;
    }
  };
  while (i < text.length) {
    const char = text[i]!;
    if (char === '\n') {
      let end = i + 1;
      while (end < text.length && text[end] === '\n') end += 1;
      push(end);
      i = end;
      continue;
    }
    if (SENTENCE_END.test(char)) {
      let end = i + 1;
      while (end < text.length && (SENTENCE_END.test(text[end]!) || CLOSERS.test(text[end]!))) end += 1;
      if (end >= text.length || /\s/.test(text[end]!)) {
        while (end < text.length && /[ \t]/.test(text[end]!)) end += 1;
        push(end);
        i = end;
        continue;
      }
      i = end;
      continue;
    }
    i += 1;
  }
  if (start < text.length) push(text.length);
  return spans;
}

/** Index of the phrase being spoken at `timeSec`, or -1 before the first one starts or without a duration. */
export function phraseAt(phrases: readonly TextSpan[], textLength: number, durationSec: number, timeSec: number): number {
  if (phrases.length === 0 || !(durationSec > 0) || !(textLength > 0)) return -1;
  const offset = (clamp01(timeSec / durationSec) * textLength);
  let found = -1;
  for (let index = 0; index < phrases.length; index += 1) {
    if (phrases[index]!.start <= offset) found = index;
    else break;
  }
  return found;
}

// ───────── Segments for rendering ─────────

export interface TranscriptSegment extends TextSpan {
  text: string;
  /** Objects whose quote covers this piece (usually 0 or 1; more where quotes overlap). */
  itemIds: ID[];
  /** The phrase being played now. */
  current: boolean;
  /** First piece of a quote: the type dot goes before it. */
  quoteStartOf: ID[];
}

/**
 * Cuts the text at every edge of a quote and of the current phrase, so each piece is uniform: plain,
 * inside one or more quotes, inside the current phrase, or both. Pieces cover the whole text.
 */
export function segmentTranscript(text: string, quotes: readonly LocatedQuote[], current?: TextSpan | null): TranscriptSegment[] {
  if (text === '') return [];
  const edges = new Set<number>([0, text.length]);
  const add = (n: number): void => void edges.add(Math.min(text.length, Math.max(0, n)));
  for (const quote of quotes) {
    add(quote.start);
    add(quote.end);
  }
  if (current) {
    add(current.start);
    add(current.end);
  }
  const cuts = [...edges].sort((a, b) => a - b);

  const segments: TranscriptSegment[] = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const start = cuts[index]!;
    const end = cuts[index + 1]!;
    if (end <= start) continue;
    segments.push({
      start,
      end,
      text: text.slice(start, end),
      itemIds: quotes.filter((quote) => quote.start <= start && quote.end >= end).map((quote) => quote.itemId),
      current: current ? current.start <= start && current.end >= end : false,
      quoteStartOf: quotes.filter((quote) => quote.start === start).map((quote) => quote.itemId),
    });
  }
  return segments;
}
