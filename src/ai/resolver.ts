import { NAME_SCORE, compareNames, rankByName } from '../domain/names';
import type { NameMatchReason, NamedEntity } from '../domain/names';
import { findSimilar, trigramSimilarity } from '../domain/similarity';
import { normalizeForSearch } from '../domain/text';
import type { ID, ItemKind } from '../domain/types';

/**
 * Entity resolution: which existing person or project a name from a record refers to, which pairs of
 * records look like the same person (merge hints), and which objects repeat each other (duplicates).
 * Pure functions over lists; the pipeline loads the lists and applies the decisions.
 */

export interface Match<T> {
  entity: T;
  score: number;
  reason: NameMatchReason;
}

export type Resolution<T> =
  /** One clearly right entity: link to it. */
  | ({ status: 'matched' } & Match<T>)
  /** Several equally good entities: do not guess, ask. */
  | { status: 'ambiguous'; candidates: Match<T>[] }
  /** Nobody fits: create a new one. `similar` are weaker look-alikes, offered as merge hints. */
  | { status: 'new'; similar: Match<T>[] };

/** Auto-link from this score up: same stem (another case form) or a part of the full name ("Маша" ↔ "Маша Иванова"). */
export const AUTO_LINK_SCORE = NAME_SCORE.partial;
/** Candidates this close to the best one make the choice ambiguous. */
const AMBIGUITY_GAP = 0.05;
const MAX_SIMILAR = 3;

export function resolveByName<T extends NamedEntity>(mention: string, entities: readonly T[]): Resolution<T> {
  const ranked = rankByName(mention, entities).map(({ entity, score, reason }) => ({ entity, score, reason }));
  const best = ranked[0];
  if (!best) return { status: 'new', similar: [] };
  if (best.score < AUTO_LINK_SCORE) return { status: 'new', similar: ranked.slice(0, MAX_SIMILAR) };

  const rivals = ranked.slice(1).filter((match) => match.score >= AUTO_LINK_SCORE && best.score - match.score <= AMBIGUITY_GAP);
  return rivals.length > 0 ? { status: 'ambiguous', candidates: [best, ...rivals] } : { status: 'matched', ...best };
}

// ───────── Merge hints ─────────

export interface MergeHint<T> {
  a: T;
  b: T;
  score: number;
  reason: NameMatchReason;
}

/** Pairs that look like the same entity, most similar first. Each pair is listed once. */
export function findMergeCandidates<T extends NamedEntity & { id: ID }>(
  entities: readonly T[],
  minScore: number = NAME_SCORE.fuzzy,
): MergeHint<T>[] {
  const hints: MergeHint<T>[] = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i];
      const b = entities[j];
      const forward = rankByName(a.name, [b], { minScore })[0];
      const backward = rankByName(b.name, [a], { minScore })[0];
      const best = [forward, backward].filter((match) => match !== undefined).sort((x, y) => y.score - x.score)[0];
      if (best) hints.push({ a, b, score: best.score, reason: best.reason });
    }
  }
  return hints.sort((x, y) => y.score - x.score);
}

/** Whether `mention` carries more name parts than `name` ("Маша Иванова" vs "Маша"). */
export function isFullerName(mention: string, name: string): boolean {
  const parts = (value: string) => value.trim().split(/[\s-]+/).filter(Boolean).length;
  return parts(mention) > parts(name) && compareNames(mention, name)?.reason === 'partial';
}

// ───────── Duplicate objects ─────────

/** Trigram similarity of titles from which two objects of one kind count as the same thing. */
export const DUPLICATE_THRESHOLD = 0.55;
/** From here a new draft is the same object restated, not just a look-alike. */
export const SAME_OBJECT_THRESHOLD = 0.75;

export interface Titled {
  id: ID;
  kind: ItemKind;
  title: string;
}

export function findDuplicate<T extends Titled>(
  draft: { kind: ItemKind; title: string },
  existing: readonly T[],
  threshold: number = DUPLICATE_THRESHOLD,
): { item: T; score: number } | undefined {
  const sameKind = existing.filter((item) => item.kind === draft.kind);
  return findSimilar(draft.title, sameKind, (item) => item.title, threshold)[0];
}

/** Two objects of one kind that rest on the same quote and share at least this much of the title are one object. */
export const SAME_QUOTE_TITLE_THRESHOLD = 0.2;

/**
 * Whether `existing` already holds the object `draft` restates: a near-identical title, or the same evidence
 * quote with a related title (the author edited the title after accepting, the quote stayed).
 */
export function findRestatement<T extends Titled & { quote?: string }>(
  draft: { kind: ItemKind; title: string; quote?: string },
  existing: readonly T[],
): T | undefined {
  const byTitle = findDuplicate(draft, existing, SAME_OBJECT_THRESHOLD)?.item;
  if (byTitle) return byTitle;
  const quote = normalizeForSearch(draft.quote ?? '');
  if (quote === '') return undefined;
  return existing.find(
    (item) =>
      item.kind === draft.kind &&
      normalizeForSearch(item.quote ?? '') === quote &&
      trigramSimilarity(item.title, draft.title) >= SAME_QUOTE_TITLE_THRESHOLD,
  );
}

/** Drops repeats within one extraction, keeping the more confident of two restatements. */
export function dedupeDrafts<T extends { kind: ItemKind; title: string; confidence?: number }>(
  drafts: readonly T[],
  threshold: number = SAME_OBJECT_THRESHOLD,
): T[] {
  const kept: T[] = [];
  for (const draft of drafts) {
    const twin = kept.findIndex(
      (other) => other.kind === draft.kind && findSimilar(draft.title, [other], (item) => item.title, threshold).length > 0,
    );
    if (twin === -1) kept.push(draft);
    else if ((draft.confidence ?? 0) > (kept[twin].confidence ?? 0)) kept[twin] = draft;
  }
  return kept;
}
