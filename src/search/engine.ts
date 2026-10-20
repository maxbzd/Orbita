import MiniSearch from 'minisearch';
import type { SearchResult } from 'minisearch';
import type { CaptureKind, DayKey, ID, ISODate, ItemKind, ItemStatus } from '../domain/types';
import { normalizeForSearch } from '../domain/text';
import { FIELD_BOOST, SEARCH_FIELDS } from './documents';
import type { SearchEntry, SearchField, SearchKind } from './documents';
import { makeSnippet, rangesOfTerms } from './highlight';
import type { Snippet, TextRange } from './highlight';
import { buildQuery, queryTerms } from './query';
import { termsOf } from './tokenize';

const MS_PER_DAY = 86_400_000;

/** Freshness: a result from today scores `1 + FRESHNESS_WEIGHT` times, one from months ago almost 1 time. */
const DEFAULT_FRESHNESS = 0.5;
const FRESHNESS_HALF_LIFE_DAYS = 60;
const DEFAULT_LIMIT = 50;

/** Every filter narrows the result; records a filter cannot apply to (a person has no day) are left out. */
export interface SearchFilters {
  /** Local days, inclusive. Apply to captures and items. */
  fromDay?: DayKey;
  toDay?: DayKey;
  /** Records that mention the person (and the person himself). */
  personId?: ID;
  /** Records of the project (and the project itself). */
  projectId?: ID;
  /** Captures and items carrying the tag (`#` and case do not matter). */
  tag?: string;
  /** Only items of these kinds / in these statuses. */
  itemKind?: ItemKind | readonly ItemKind[];
  itemStatus?: ItemStatus | readonly ItemStatus[];
  /** Only captures of these kinds. */
  captureKind?: CaptureKind | readonly CaptureKind[];
}

export interface SearchOptions {
  /** Search only these kinds of records; all by default. */
  kinds?: readonly SearchKind[];
  filters?: SearchFilters;
  /** Best results to return (default 50). */
  limit?: number;
  /** `and`: every word must be found (default); `or`: any of them, more words rank higher. */
  combine?: 'and' | 'or';
  /** Match word beginnings, so a query can be typed in part (default true). */
  prefix?: boolean;
  /** Tolerate typos and case endings («Маше» finds «Маша») (default true). */
  fuzzy?: boolean;
  /** How much a fresh record outweighs an old one; 0 turns it off (default 0.5). */
  freshness?: number;
  /** The "current" instant for freshness; tests pin it. */
  now?: Date | number | ISODate;
}

/** Where a query matched in one field of a result. */
export interface FieldHighlight {
  field: SearchField;
  /** The whole field text, as stored. */
  text: string;
  ranges: TextRange[];
}

export interface SearchHit {
  /** `kind:id` */
  key: string;
  kind: SearchKind;
  id: ID;
  itemKind?: ItemKind;
  captureKind?: CaptureKind;
  /** Label for the result list; `titleRanges` are the matches inside it. */
  title: string;
  titleRanges: TextRange[];
  /** An excerpt around the best match outside the title, if there is one. */
  snippet?: Snippet & { field: SearchField };
  /** Every matching field, most telling first. */
  highlights: FieldHighlight[];
  /** Relevance including freshness; only meaningful for comparing results of one query. */
  score: number;
  day?: DayKey;
  at: ISODate;
}

type IndexDocument = { id: string } & Partial<Record<SearchField, string>>;

const asList = <T>(value: T | readonly T[] | undefined): readonly T[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? (value as readonly T[]) : [value as T];

function toMillis(now: SearchOptions['now']): number {
  if (now === undefined) return Date.now();
  return now instanceof Date ? now.getTime() : new Date(now).getTime();
}

function freshnessFactor(at: ISODate, now: number, weight: number): number {
  if (weight <= 0) return 1;
  const ageDays = Math.max(0, (now - Date.parse(at)) / MS_PER_DAY);
  return 1 + weight * 0.5 ** (ageDays / FRESHNESS_HALF_LIFE_DAYS);
}

/** Turns options into a predicate over entries. */
function entryFilter({ kinds, filters = {} }: Pick<SearchOptions, 'kinds' | 'filters'>): (entry: SearchEntry) => boolean {
  const itemKinds = asList(filters.itemKind);
  const itemStatuses = asList(filters.itemStatus);
  const captureKinds = asList(filters.captureKind);
  const tag = filters.tag === undefined ? undefined : normalizeForSearch(filters.tag).replace(/^#/, '');
  const { fromDay, toDay, personId, projectId } = filters;

  return (entry) => {
    if (kinds && !kinds.includes(entry.kind)) return false;
    if (itemKinds && !(entry.itemKind && itemKinds.includes(entry.itemKind))) return false;
    if (itemStatuses && !(entry.itemStatus && itemStatuses.includes(entry.itemStatus))) return false;
    if (captureKinds && !(entry.captureKind && captureKinds.includes(entry.captureKind))) return false;
    if (fromDay !== undefined && !(entry.day !== undefined && entry.day >= fromDay)) return false;
    if (toDay !== undefined && !(entry.day !== undefined && entry.day <= toDay)) return false;
    if (personId !== undefined && !entry.personIds.includes(personId)) return false;
    if (projectId !== undefined && !entry.projectIds.includes(projectId)) return false;
    if (tag !== undefined && !entry.tags.includes(tag)) return false;
    return true;
  };
}

/**
 * A full-text index over `SearchEntry`s. Knows nothing about the database or React: the sync layer
 * feeds it records, the UI subscribes to `version` changes and calls `search`.
 */
export class SearchIndex {
  private readonly mini = new MiniSearch<IndexDocument>({
    fields: [...SEARCH_FIELDS],
    idField: 'id',
    // Our tokenizer already returns normalized words, the same one the highlighter uses.
    tokenize: termsOf,
    processTerm: (term) => term,
    searchOptions: { boost: { ...FIELD_BOOST } },
  });
  private readonly entries = new Map<string, SearchEntry>();
  private readonly listeners = new Set<() => void>();
  private changes = 0;

  get size(): number {
    return this.entries.size;
  }

  /** Grows with every change; for `useSyncExternalStore`-style subscriptions and cache keys. */
  get version(): number {
    return this.changes;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** `updatedAt` of the record as it was indexed. */
  versionOf(key: string): ISODate | undefined {
    return this.entries.get(key)?.version;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  /** Adds or replaces entries and drops others in one step: listeners are told once. */
  update(upserts: readonly SearchEntry[], removals: readonly string[] = []): void {
    let changed = false;
    for (const key of removals) {
      if (!this.entries.delete(key)) continue;
      this.mini.discard(key);
      changed = true;
    }
    for (const entry of upserts) {
      if (this.entries.has(entry.key)) this.mini.discard(entry.key);
      this.entries.set(entry.key, entry);
      this.mini.add({ id: entry.key, ...entry.fields });
      changed = true;
    }
    if (!changed) return;
    this.changes += 1;
    for (const listener of [...this.listeners]) listener();
  }

  clear(): void {
    this.update([], this.keys());
  }

  /** Calls `listener` after every change; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const terms = queryTerms(query);
    if (terms.length === 0) return [];

    const { limit = DEFAULT_LIMIT, combine = 'and', prefix = true, fuzzy = true, freshness = DEFAULT_FRESHNESS } = options;
    const accepts = entryFilter(options);
    const now = toMillis(options.now);

    const ranked: { result: SearchResult; entry: SearchEntry; score: number }[] = [];
    const results = this.mini.search(buildQuery(terms, { combine, prefix, fuzzy }), {
      filter: (result) => {
        const entry = this.entries.get(result.id as string);
        return entry !== undefined && accepts(entry);
      },
    });
    for (const result of results) {
      const entry = this.entries.get(result.id as string);
      if (entry) ranked.push({ result, entry, score: result.score * freshnessFactor(entry.at, now, freshness) });
    }
    ranked.sort((a, b) => b.score - a.score || b.entry.at.localeCompare(a.entry.at) || a.entry.key.localeCompare(b.entry.key));

    return ranked.slice(0, Math.max(0, limit)).map(({ result, entry, score }) => this.toHit(result, entry, score));
  }

  private toHit(result: SearchResult, entry: SearchEntry, score: number): SearchHit {
    // Index terms that matched, per field (a prefix or typo match reports the term found in the text).
    const matchedByField = new Map<SearchField, Set<string>>();
    const matchedAnywhere = new Set<string>();
    for (const [term, fields] of Object.entries(result.match)) {
      matchedAnywhere.add(term);
      for (const field of fields as SearchField[]) {
        const terms = matchedByField.get(field) ?? new Set<string>();
        terms.add(term);
        matchedByField.set(field, terms);
      }
    }

    const highlights: FieldHighlight[] = [];
    for (const [field, terms] of matchedByField) {
      const text = entry.fields[field];
      if (text === undefined) continue;
      const ranges = rangesOfTerms(text, terms);
      if (ranges.length > 0) highlights.push({ field, text, ranges });
    }
    highlights.sort((a, b) => SEARCH_FIELDS.indexOf(a.field) - SEARCH_FIELDS.indexOf(b.field));

    // The title is shown on its own line, so the excerpt comes from some other field.
    const outside = highlights.find((highlight) => highlight.field !== 'title' && highlight.field !== 'name');

    return {
      key: entry.key,
      kind: entry.kind,
      id: entry.id,
      ...(entry.itemKind !== undefined && { itemKind: entry.itemKind }),
      ...(entry.captureKind !== undefined && { captureKind: entry.captureKind }),
      title: entry.title,
      // The label may be derived (the first line of a capture without a title), so mark it by the matched terms.
      titleRanges: rangesOfTerms(entry.title, matchedAnywhere),
      ...(outside && { snippet: { field: outside.field, ...makeSnippet(outside.text, outside.ranges) } }),
      highlights,
      score,
      ...(entry.day !== undefined && { day: entry.day }),
      at: entry.at,
    };
  }
}
