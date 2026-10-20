import { useEffect, useMemo, useState } from 'react';
import { ensureSearchIndex, search, searchIndex } from '../../search';
import type { SearchFilters, SearchHit } from '../../search';
import type { ItemKind } from '../../domain/types';
import type { ItemsByCapture } from './filters';

export const SEARCH_LIMIT = 40;
const DEBOUNCE_MS = 120;

export function useDebounced<T>(value: T, delay = DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export interface SearchState {
  /** The index is loaded and the results below answer the query. */
  ready: boolean;
  hits: SearchHit[];
  /** The index could not be built (a database error). */
  failed: boolean;
}

/**
 * Hits for a query over captures, objects and people. The index is built on first use and the query reruns
 * when records change. `type` keeps the captures that hold an object of that kind, and those objects.
 */
export function useSearchHits(query: string, filters: SearchFilters, type: ItemKind | undefined, itemsByCapture: ItemsByCapture | undefined): SearchState {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const text = query.trim();

  useEffect(() => {
    if (text === '') return undefined;
    let alive = true;
    ensureSearchIndex().then(
      () => alive && setReady(true),
      () => alive && setFailed(true),
    );
    const unsubscribe = searchIndex.subscribe(() => setVersion((n) => n + 1));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [text === '']); // eslint-disable-line react-hooks/exhaustive-deps -- only whether there is a query matters here

  const filterKey = JSON.stringify(filters);
  const hits = useMemo(() => {
    if (text === '' || !ready) return [];
    const found = search(text, { kinds: type ? ['capture', 'item'] : ['capture', 'item', 'person'], filters, limit: SEARCH_LIMIT });
    if (!type) return found;
    return found.filter((hit) => {
      if (hit.kind === 'item') return hit.itemKind === type;
      return (itemsByCapture?.get(hit.id) ?? []).some((item) => item.kind === type);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `filters` is compared by value through `filterKey`
  }, [text, ready, version, filterKey, type, itemsByCapture]);

  return { ready: ready || text === '', hits, failed };
}
