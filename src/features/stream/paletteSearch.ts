import { ensureSearchIndex, search } from '../../search';
import type { SearchHit, SearchKind } from '../../search';
import type { CommandProvider } from '../../ui/shell/commandFilter';
import { t } from '../../i18n';

const LIMIT = 6;

const GROUP: Record<SearchKind, string> = { get capture() { return t('Records') }, get item() { return t('Objects') }, get person() { return t('People') }, get project() { return t('Projects') } };
const ORDER: Record<SearchKind, number> = { person: 0, capture: 1, item: 2, project: 3 };

/** Where a hit leads; projects have no screen of their own yet. */
function pathOf(hit: SearchHit): string | undefined {
  if (hit.kind === 'capture') return `/entry/${hit.id}`;
  if (hit.kind === 'person') return `/people/${hit.id}`;
  if (hit.kind === 'item') return `/items/${hit.itemKind ?? ''}`;
  return undefined;
}

/**
 * Full-text search for ⌘K: records, objects and people from the same index as the stream.
 * `go` navigates (the shell passes the router's `navigate`); the palette closes itself after running an item.
 */
export function createSearchProvider(go: (path: string) => void): CommandProvider {
  return {
    id: 'search',
    async search(query, signal) {
      if (query.trim().length < 2) return [];
      await ensureSearchIndex();
      if (signal.aborted) return [];
      // One block per group, best hit first inside it: the palette prints a heading at every change of group.
      return search(query, { kinds: ['capture', 'item', 'person'], limit: LIMIT * 2 })
        .slice(0, LIMIT)
        .map((hit, index) => ({ hit, index }))
        .sort((a, b) => ORDER[a.hit.kind] - ORDER[b.hit.kind] || a.index - b.index)
        .map(({ hit }) => hit)
        .flatMap((hit) => {
          const path = pathOf(hit);
          if (!path) return [];
          return [
            {
              id: `search:${hit.key}`,
              title: hit.title || t('Untitled'),
              subtitle: hit.snippet?.text,
              icon: hit.kind === 'person' ? ('people' as const) : ('stream' as const),
              group: GROUP[hit.kind],
              run: () => go(path),
            },
          ];
        });
    },
  };
}
