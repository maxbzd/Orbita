import { normalizeForSearch } from './text';

/**
 * Personal names: normalization, case-insensitive stems («Маши/Машу/Машей» → «маш»),
 * typo-tolerant comparison (Damerau–Levenshtein) and ranking of candidates.
 *
 * The stemmer is intentionally simple: it strips case endings until none is left, which makes
 * «Алексей/Алексея/Алексеем» share a stem but also merges «Лена» with «Лёня» (ё→е). That is why
 * callers must treat anything below `NAME_SCORE.exact` as "ask the user", never as certain.
 */

// ───────── Normalization ─────────

/** Lower case, `ё`→`е`, no punctuation (apostrophes dropped), single spaces: `«Иван  Петров.»` → `иван петров`. */
export function normalizeName(name: string): string {
  return normalizeForSearch(name)
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/(^|\s)-+|-+(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `иван петров-сидоров` → `Иван Петров-Сидоров`. For display of names that arrive in lower case. */
export function titleCaseName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/(^|[\s-])(\p{L})/gu, (_, separator: string, letter: string) => `${separator}${letter.toUpperCase()}`);
}

// ───────── Stemming ─────────

/** Case endings of Russian names and surnames, tried longest first; single letters last. Latin names have none. */
// i18n-ignore-start: language data, not UI text
const ENDINGS = [
  'ами', 'ями', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими',
  'ой', 'ей', 'ом', 'ем', 'ам', 'ям', 'ым', 'им', 'ою', 'ею', 'ах', 'ях',
  'ия', 'ие', 'ию', 'ии', 'ья', 'ье', 'ью', 'ьи',
  'а', 'я', 'у', 'ю', 'ы', 'и', 'е', 'о', 'ь', 'й',
] as const;
// i18n-ignore-end
const MIN_STEM_LENGTH = 2;

function stemWord(word: string): string {
  let stem = word;
  for (let stripped = true; stripped; ) {
    stripped = false;
    for (const ending of ENDINGS) {
      if (stem.endsWith(ending) && stem.length - ending.length >= MIN_STEM_LENGTH) {
        stem = stem.slice(0, -ending.length);
        stripped = true;
        break;
      }
    }
  }
  return stem;
}

/** Stem of one name token; hyphenated parts are stemmed separately. */
export function nameStem(token: string): string {
  return normalizeName(token).split('-').map(stemWord).join('-');
}

/** Hyphen and space both separate tokens: «Анна-Мария» = «Анна Мария», «онлайн школа» = «онлайн-школа». */
function stemTokens(name: string): string[] {
  const normalized = normalizeName(name);
  return normalized === '' ? [] : normalized.split(/[\s-]+/).map(nameStem);
}

/** Case-insensitive, inflection-insensitive key: equal keys mean "same name in another case". */
export function nameKey(name: string): string {
  return stemTokens(name).join(' ');
}

// ───────── Edit distance ─────────

/** Optimal-string-alignment distance: insertions, deletions, substitutions and adjacent swaps cost 1. */
export function damerauLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // d[i][j] = distance between the first i chars of a and the first j chars of b.
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** Typos tolerated for a stem of this length: none for very short names (Миша ≠ Маша). */
export function maxEditDistance(length: number): number {
  if (length <= 3) return 0;
  return length <= 6 ? 1 : 2;
}

// ───────── Comparison ─────────

export const NAME_SCORE = {
  /** Same normalized text. */
  exact: 1,
  /** Normalized text equals one of the aliases. */
  alias: 0.97,
  /** Same stems: a different case form («Машу» vs «Маша»). */
  stem: 0.92,
  /** One name is a part of the other («Маша» vs «Маша Иванова»). */
  partial: 0.75,
  /** Stems differ by a typo. */
  fuzzy: 0.6,
  /** Part of the name, with a typo. */
  fuzzyPartial: 0.45,
} as const;

export type NameMatchReason = 'exact' | 'alias' | 'stem' | 'partial' | 'fuzzy' | 'fuzzyPartial';

export interface NameComparison {
  score: number;
  reason: NameMatchReason;
}

/**
 * Compares two names: any case form, any token order («Иванов Иван» = «Иван Иванов»), a name may be
 * a part of the other. Returns null when they do not match.
 */
export function compareNames(a: string, b: string): NameComparison | null {
  const normalizedA = normalizeName(a);
  const normalizedB = normalizeName(b);
  if (normalizedA === '' || normalizedB === '') return null;
  if (normalizedA === normalizedB) return { score: NAME_SCORE.exact, reason: 'exact' };

  const tokensA = stemTokens(a);
  const tokensB = stemTokens(b);
  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];

  const unused = [...longer];
  let typos = 0;
  for (const token of shorter) {
    let bestIndex = -1;
    let bestDistance = Infinity;
    unused.forEach((candidate, index) => {
      const distance = damerauLevenshtein(token, candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    if (bestIndex === -1) return null;
    if (bestDistance > maxEditDistance(Math.max(token.length, unused[bestIndex].length))) return null;
    typos += bestDistance;
    unused.splice(bestIndex, 1);
  }

  const wholeName = shorter.length === longer.length;
  if (typos === 0) {
    return wholeName ? { score: NAME_SCORE.stem, reason: 'stem' } : { score: NAME_SCORE.partial, reason: 'partial' };
  }
  return wholeName ? { score: NAME_SCORE.fuzzy, reason: 'fuzzy' } : { score: NAME_SCORE.fuzzyPartial, reason: 'fuzzyPartial' };
}

export function namesMatch(a: string, b: string, minScore: number = NAME_SCORE.stem): boolean {
  const comparison = compareNames(a, b);
  return comparison !== null && comparison.score >= minScore;
}

// ───────── Candidates and aliases ─────────

export interface NamedEntity {
  name: string;
  aliases?: readonly string[];
}

export interface NameMatch<T extends NamedEntity> extends NameComparison {
  entity: T;
}

/**
 * Ranks entities by how well `query` matches their name or any alias, best first.
 * An exact alias hit scores `NAME_SCORE.alias`; other alias matches keep the name-matching score.
 */
export function rankByName<T extends NamedEntity>(
  query: string,
  entities: readonly T[],
  { minScore = NAME_SCORE.fuzzyPartial }: { minScore?: number } = {},
): NameMatch<T>[] {
  const matches: NameMatch<T>[] = [];
  for (const entity of entities) {
    let best = compareNames(query, entity.name);
    for (const alias of entity.aliases ?? []) {
      const viaAlias = compareNames(query, alias);
      if (viaAlias === null) continue;
      const adjusted =
        viaAlias.reason === 'exact' ? { score: NAME_SCORE.alias, reason: 'alias' as const } : viaAlias;
      if (best === null || adjusted.score > best.score) best = adjusted;
    }
    if (best !== null && best.score >= minScore) matches.push({ entity, ...best });
  }
  return matches.sort((x, y) => y.score - x.score || x.entity.name.localeCompare(y.entity.name, 'ru'));
}

/**
 * Aliases without duplicates (by normalized form) and without the canonical name itself,
 * keeping the first spelling seen.
 */
export function uniqueAliases(canonicalName: string, ...lists: readonly (readonly string[])[]): string[] {
  const seen = new Set([normalizeName(canonicalName)]);
  const result: string[] = [];
  for (const alias of lists.flat()) {
    const key = normalizeName(alias);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    result.push(alias.trim());
  }
  return result;
}
