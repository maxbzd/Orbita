/** Combining acute accent, used for stress marks in Russian text. */
const STRESS_MARK = /́/g;
const WORD = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;

/**
 * Normalization for search and comparison: NFKC, lower case, `ё`→`е`, no stress marks,
 * single spaces. Never use the result for display.
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .replace(STRESS_MARK, '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words of a text (letters and digits, inner hyphens and apostrophes kept), as written. */
export function words(text: string): string[] {
  return text.match(WORD) ?? [];
}

export function countWords(text: string): number {
  return words(text).length;
}

/** Cuts to `max` characters (code points) and adds an ellipsis when something was removed. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, Math.max(0, max - 1)).join('').trimEnd()}…`;
}
