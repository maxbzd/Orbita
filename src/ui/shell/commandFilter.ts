import type { IconName } from '../icons';

/** One entry of the command palette: an action ("Новая запись") or a search result (a capture, a person). */
export interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: IconName;
  /** Extra words the filter matches (synonyms, English names). */
  keywords?: readonly string[];
  /** Shown as key caps on the right: ['Ctrl', 'Shift', 'R']. */
  shortcut?: readonly string[];
  /** Group heading ("Перейти", "Записи", "Люди"). */
  group?: string;
  run(): void;
}

/** A source of results that depends on the query: full-text search, people, the ask pipeline. */
export interface CommandProvider {
  id: string;
  group?: string;
  /** May be async. `signal` aborts when the query changes or the palette closes. */
  search(query: string, signal: AbortSignal): CommandItem[] | Promise<CommandItem[]>;
}

/** Lower case and ё -> е, the same normalisation the full-text search uses. */
export function normalizeQuery(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').trim();
}

function score(item: CommandItem, tokens: readonly string[]): number | null {
  const title = normalizeQuery(item.title);
  const rest = normalizeQuery([item.subtitle ?? '', ...(item.keywords ?? []), item.group ?? ''].join(' '));
  let total = 0;
  for (const token of tokens) {
    if (title.startsWith(token)) total += 0;
    else if (title.split(/[\s\-—·]+/).some((word) => word.startsWith(token))) total += 1;
    else if (title.includes(token)) total += 2;
    else if (rest.includes(token)) total += 3;
    else return null; // every word must match somewhere
  }
  return total;
}

/**
 * Keeps the items that match every word of the query, best matches first (title prefix, then word
 * prefix, then substring, then subtitle/keywords); ties keep the order they were given in.
 */
export function filterCommands(items: readonly CommandItem[], query: string): CommandItem[] {
  const tokens = normalizeQuery(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...items];
  return items
    .map((item, index) => ({ item, index, s: score(item, tokens) }))
    .filter((entry): entry is { item: CommandItem; index: number; s: number } => entry.s !== null)
    .sort((a, b) => a.s - b.s || a.index - b.index)
    .map((entry) => entry.item);
}
