import { normalizeForSearch } from '../domain/text';

/** Letters, digits and combining marks (stress marks stay inside the word they belong to). Hyphens split words. */
const TOKEN = /[\p{L}\p{N}\p{M}]+/gu;

export interface Token {
  /** Normalized: lower case, `ё`→`е`. This is what the index and the query work with. */
  term: string;
  /** Offsets of the word in the original (not normalized) text, `end` exclusive. */
  start: number;
  end: number;
}

/** Words of a text with their positions in it: the one tokenizer shared by indexing, querying and highlighting. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const term = normalizeForSearch(match[0]);
    if (term === '') continue;
    tokens.push({ term, start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/** Normalized terms of a text, in order, with repeats. */
export function termsOf(text: string): string[] {
  return tokenize(text).map((token) => token.term);
}
