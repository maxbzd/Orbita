import { tokenize } from './tokenize';

/** `[start, end)` offsets (UTF-16 units) into a text. */
export type TextRange = readonly [start: number, end: number];

export interface TextSegment {
  text: string;
  match: boolean;
}

export interface Snippet {
  /** The excerpt, with `…` where text was cut off and line breaks flattened to spaces. */
  text: string;
  /** Matches inside `text`. */
  ranges: TextRange[];
}

/** Ranges of the words of `text` whose normalized form is among `terms`. */
export function rangesOfTerms(text: string, terms: ReadonlySet<string>): TextRange[] {
  return tokenize(text)
    .filter((token) => terms.has(token.term))
    .map((token) => [token.start, token.end] as const);
}

/** Cuts a text into alternating plain and matching pieces, ready to render as text and `<mark>`. */
export function splitByRanges(text: string, ranges: readonly TextRange[]): TextSegment[] {
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

const ELLIPSIS = '…';
/** How much context to keep before the first match. */
const LEAD = 32;

/**
 * An excerpt of at most about `maxLength` characters that starts a little before the first match
 * and, if it fits, shows more of them. Cuts fall on word boundaries.
 */
export function makeSnippet(text: string, ranges: readonly TextRange[], maxLength = 140): Snippet {
  const flat = text.replace(/\s/g, ' ');
  if (flat.length <= maxLength) return { text: flat, ranges: [...ranges] };

  const first = ranges[0];
  const keepFrom = first?.[0] ?? 0;
  let from = Math.max(0, keepFrom - LEAD);
  if (from > 0 && flat[from - 1] !== ' ') {
    const space = flat.indexOf(' ', from);
    from = space !== -1 && space < keepFrom ? space + 1 : keepFrom;
  }
  while (from < keepFrom && flat[from] === ' ') from++;

  let to = Math.min(flat.length, from + maxLength);
  if (to < flat.length && flat[to] !== ' ') {
    const space = flat.lastIndexOf(' ', to);
    if (space > Math.max(from, first?.[1] ?? from)) to = space;
  }
  while (to > from && flat[to - 1] === ' ') to--;

  const prefix = from > 0 ? ELLIPSIS : '';
  const suffix = to < flat.length ? ELLIPSIS : '';
  const shift = prefix.length - from;
  return {
    text: `${prefix}${flat.slice(from, to)}${suffix}`,
    ranges: ranges.filter(([start, end]) => start >= from && end <= to).map(([start, end]) => [start + shift, end + shift] as const),
  };
}
