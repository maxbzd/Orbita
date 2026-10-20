import { normalizeForSearch, words } from './text';

/**
 * Trigram similarity (the pg_trgm scheme): every word is padded with two spaces in front and one
 * behind, then split into 3-character grams; similarity is |A ∩ B| / |A ∪ B|.
 * Good for "is this the same sentence reworded a bit", e.g. duplicate detection.
 */

export function trigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (const word of words(normalizeForSearch(text))) {
    const padded = `  ${word} `;
    for (let i = 0; i <= padded.length - 3; i++) grams.add(padded.slice(i, i + 3));
  }
  return grams;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared++;
  return shared / (a.size + b.size - shared);
}

/** 0 (nothing in common) … 1 (same set of trigrams). Two empty texts are not similar. */
export function trigramSimilarity(a: string, b: string): number {
  return jaccard(trigrams(a), trigrams(b));
}

export interface SimilarMatch<T> {
  item: T;
  score: number;
}

/** Items whose text is at least `threshold` similar to `text`, most similar first. */
export function findSimilar<T>(
  text: string,
  items: readonly T[],
  getText: (item: T) => string,
  threshold = 0.5,
): SimilarMatch<T>[] {
  const query = trigrams(text);
  const matches: SimilarMatch<T>[] = [];
  for (const item of items) {
    const score = jaccard(query, trigrams(getText(item)));
    if (score > 0 && score >= threshold) matches.push({ item, score });
  }
  return matches.sort((x, y) => y.score - x.score);
}
