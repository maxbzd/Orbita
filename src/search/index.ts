/**
 * Full-text search over captures, items, people and projects (Russian-aware, offline, in memory).
 *
 *   await ensureSearchIndex();                       // once, at app start or on first search
 *   const hits = search('обещал Маше', { kinds: ['item'], filters: { fromDay: '2026-10-01' } });
 *   searchIndex.subscribe(rerun);                    // re-run when the index changes
 */
import { searchIndex } from './sync';
import type { SearchHit, SearchOptions } from './engine';

export { SEARCH_FIELDS, SEARCH_KINDS } from './documents';
export type { SearchEntry, SearchField, SearchKind, SearchTable } from './documents';
export { SearchIndex } from './engine';
export type { FieldHighlight, SearchFilters, SearchHit, SearchOptions } from './engine';
export { makeSnippet, rangesOfTerms, splitByRanges } from './highlight';
export type { Snippet, TextRange, TextSegment } from './highlight';
export { tokenize } from './tokenize';
export type { Token } from './tokenize';
export { buildIndex, ensureSearchIndex, searchIndex, startIndexSync, updateIndex } from './sync';
export type { IndexChange, IndexSync } from './sync';

/** Searches the application index (empty until `ensureSearchIndex` / `buildIndex` has loaded it). */
export function search(query: string, options?: SearchOptions): SearchHit[] {
  return searchIndex.search(query, options);
}
