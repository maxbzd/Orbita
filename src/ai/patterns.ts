import { capturesRepo, checkinsRepo, itemsRepo, patternsRepo } from '../db';
import { addDays, localDayKey } from '../domain/dates';
import { isHiddenFromAi } from '../domain/hidden';
import { trigramSimilarity } from '../domain/similarity';
import { truncate } from '../domain/text';
import type { Capture, CheckIn, DayKey, ID, Pattern, PatternStatus } from '../domain/types';
import { normalizeUnit } from './extract-drafts';
import { buildPatternsSystem, buildPatternsUser } from './prompts/patterns';
import type { PatternPromptCapture, PatternPromptKnown } from './prompts/patterns';
import { PatternsSchema, SCHEMA_NAMES, patternsJsonSchema } from './prompts/schemas';
import type { PatternDraft } from './prompts/schemas';
import type { LlmProvider, Usage } from './providers/types';
import { locateQuote } from './quotes';
import { t } from '../i18n';

/**
 * Looking for what repeats: the last weeks of records are condensed into short summaries, the model names
 * the patterns it sees (with the records that show them), and the answer is merged with the patterns that
 * are already known — same pattern, more evidence — instead of piling up near-duplicates.
 */

export const DEFAULT_WEEKS = 6;
/** Fewer records than this, or all on one day, cannot show a repetition. */
export const MIN_CAPTURES = 4;
const MAX_CAPTURES = 80;
const MAX_KNOWN = 30;
const MAX_ITEMS_PER_CAPTURE = 6;
const SUMMARY_FALLBACK_CHARS = 280;
const TITLE_FALLBACK_CHARS = 60;
const MAX_CONFIDENCE = 0.9;
/** Confidence the model may claim for a given number of records, as the prompt demands. */
const CONFIDENCE_CAPS = [
  { upTo: 2, cap: 0.5 },
  { upTo: 4, cap: 0.7 },
  { upTo: Number.POSITIVE_INFINITY, cap: 0.85 },
] as const;
/** Each new record of evidence lifts the confidence of a known pattern a little. */
const CONFIDENCE_PER_NEW_EVIDENCE = 0.03;
/** Titles this similar are one pattern even when the model did not name the known one. */
export const SAME_PATTERN_TITLE_SIMILARITY = 0.55;
const MIN_EVIDENCE_DAYS = 2;
const MAX_TITLE_CHARS = 90;
const MAX_DESCRIPTION_CHARS = 400;
const MAX_SUGGESTION_CHARS = 240;

export interface PatternSearchDeps {
  llm: LlmProvider;
  /** How many weeks back to look. */
  weeks?: number;
  now?: Date;
  signal?: AbortSignal;
}

export interface PatternSearchResult {
  created: Pattern[];
  /** Known patterns that got new evidence. */
  updated: Pattern[];
  /** Drafts dropped: rejected by the user before, a single day of evidence, unknown records. */
  skipped: number;
  /** Records the model looked at. */
  examined: number;
  /** Set when the model was not asked at all. */
  reason?: 'not-enough-data';
  usage?: Usage;
}

// ───────── Preparing what the model sees ─────────

const describeMood = (checkIn: CheckIn): string => t('mood {toFixed}, energy {round}%', { toFixed: checkIn.valence.toFixed(1), round: Math.round(checkIn.energy * 100) });

interface Source {
  ref: string;
  capture: Capture;
  /** The text the model saw for this record: quotes are checked against it. */
  shown: string;
}

async function loadSources(fromDay: DayKey, toDay: DayKey): Promise<{ sources: Source[]; prompt: PatternPromptCapture[] }> {
  const recent = (await capturesRepo.list({ fromDay, toDay })).filter((capture) => capture.text.trim() !== '');
  // `list` is newest first; the model reads oldest to newest.
  const captures = recent.slice(0, MAX_CAPTURES).reverse();
  const ids = new Set(captures.map((capture) => capture.id));

  const [items, allCheckIns] = await Promise.all([itemsRepo.list(), checkinsRepo.listRange(fromDay, toDay)]);
  const checkIns = allCheckIns.filter((checkIn) => !isHiddenFromAi(checkIn));
  const itemsOf = new Map<ID, string[]>();
  for (const item of items) {
    if (!item.captureId || !ids.has(item.captureId) || item.status === 'proposed' || item.status === 'dismissed') continue;
    itemsOf.set(item.captureId, [...(itemsOf.get(item.captureId) ?? []), `${item.kind}: ${item.title}`]);
  }
  const moodOf = new Map(checkIns.filter((checkIn) => checkIn.captureId).map((checkIn) => [checkIn.captureId as ID, describeMood(checkIn)]));

  const sources: Source[] = [];
  const prompt: PatternPromptCapture[] = [];
  for (const [index, capture] of captures.entries()) {
    const ref = `c${index + 1}`;
    const title = capture.title?.trim() || truncate(capture.text.replace(/\s+/g, ' ').trim(), TITLE_FALLBACK_CHARS);
    const summary = capture.summary?.trim() || truncate(capture.text.replace(/\s+/g, ' ').trim(), SUMMARY_FALLBACK_CHARS);
    const objects = (itemsOf.get(capture.id) ?? []).slice(0, MAX_ITEMS_PER_CAPTURE);
    const mood = moodOf.get(capture.id);
    sources.push({ ref, capture, shown: [title, summary, ...objects].join('\n') });
    prompt.push({ ref, day: capture.day, title, summary, tags: capture.tags, items: objects, ...(mood && { mood }) });
  }
  return { sources, prompt };
}

// ───────── Merging the answer into what is known ─────────

const capFor = (evidenceCount: number): number => CONFIDENCE_CAPS.find(({ upTo }) => evidenceCount <= upTo)?.cap ?? MAX_CONFIDENCE;

function clean(text: string | null | undefined, max: number): string {
  return truncate((text ?? '').replace(/\s+/g, ' ').trim(), max);
}

/** Evidence of a draft: records the model cited that exist, once each, with quotes that really are in the text. */
function evidenceOf(draft: PatternDraft, sources: ReadonlyMap<string, Source>): Pattern['evidence'] {
  const seen = new Set<ID>();
  const evidence: Pattern['evidence'] = [];
  for (const cited of draft.evidence) {
    const source = sources.get(cited.ref.trim().toLowerCase());
    if (!source || seen.has(source.capture.id)) continue;
    seen.add(source.capture.id);
    // The quote may come from the full record or from the summary the model read; anything else is invented.
    const located = locateQuote(source.capture.text, cited.quote) ?? locateQuote(source.shown, cited.quote);
    evidence.push({ captureId: source.capture.id, day: source.capture.day, ...(located && { quote: located.quote }) });
  }
  return evidence.sort((a, b) => a.day.localeCompare(b.day));
}

const distinctDays = (evidence: Pattern['evidence']): number => new Set(evidence.map((entry) => entry.day)).size;

interface Known {
  ref: string;
  pattern: Pattern;
}

function findKnown(draft: PatternDraft, known: readonly Known[]): Known | undefined {
  const ref = draft.existingId?.trim().toLowerCase();
  const byRef = ref ? known.find((entry) => entry.ref === ref) : undefined;
  if (byRef) return byRef;
  const title = clean(draft.title, MAX_TITLE_CHARS);
  return known
    .map((entry) => ({ entry, score: trigramSimilarity(title, entry.pattern.title) }))
    .filter(({ score }) => score >= SAME_PATTERN_TITLE_SIMILARITY)
    .sort((a, b) => b.score - a.score)[0]?.entry;
}

/** New confidence of a known pattern: the better of the two estimates plus a little for each new record. */
export function mergeConfidence(known: number, claimed: number, newEvidence: number): number {
  return Math.min(MAX_CONFIDENCE, Math.max(known, claimed) + CONFIDENCE_PER_NEW_EVIDENCE * newEvidence);
}

async function mergeInto(known: Pattern, draft: PatternDraft, evidence: Pattern['evidence']): Promise<Pattern | undefined> {
  const have = new Set(known.evidence.map((entry) => entry.captureId));
  const added = evidence.filter((entry) => !have.has(entry.captureId));
  if (added.length === 0) return undefined;

  const merged = [...known.evidence, ...added].sort((a, b) => a.day.localeCompare(b.day));
  const days = merged.map((entry) => entry.day);
  const claimed = Math.min(normalizeUnit(draft.confidence, known.confidence), capFor(merged.length));
  const status: PatternStatus = known.status === 'resolved' && added.some((entry) => entry.day > known.lastSeenDay) ? 'candidate' : known.status;
  return patternsRepo.update(known.id, {
    evidence: merged,
    occurrences: merged.length,
    firstSeenDay: days[0] < known.firstSeenDay ? days[0] : known.firstSeenDay,
    lastSeenDay: days[days.length - 1] > known.lastSeenDay ? days[days.length - 1] : known.lastSeenDay,
    confidence: mergeConfidence(known.confidence, claimed, added.length),
    status,
    // The model's refined wording replaces a candidate's; what the user confirmed stays as it was.
    ...(known.status === 'candidate' && clean(draft.description, MAX_DESCRIPTION_CHARS) !== '' && { description: clean(draft.description, MAX_DESCRIPTION_CHARS) }),
    ...(!known.suggestion && clean(draft.suggestion, MAX_SUGGESTION_CHARS) !== '' && { suggestion: clean(draft.suggestion, MAX_SUGGESTION_CHARS) }),
  });
}

/**
 * Asks the model for patterns in the last `weeks` weeks of records and stores them as `candidate`
 * patterns (or adds evidence to known ones). Nothing is asked when there is too little to compare.
 */
export async function findPatterns(deps: PatternSearchDeps): Promise<PatternSearchResult> {
  const today = localDayKey(deps.now ?? new Date());
  const fromDay = addDays(today, -7 * (deps.weeks ?? DEFAULT_WEEKS) + 1);
  const { sources, prompt } = await loadSources(fromDay, today);

  if (sources.length < MIN_CAPTURES || new Set(sources.map((source) => source.capture.day)).size < MIN_EVIDENCE_DAYS) {
    return { created: [], updated: [], skipped: 0, examined: sources.length, reason: 'not-enough-data' };
  }

  const known: Known[] = (await patternsRepo.list())
    .sort((a, b) => b.lastSeenDay.localeCompare(a.lastSeenDay))
    .slice(0, MAX_KNOWN)
    .map((pattern, index) => ({ ref: `p${index + 1}`, pattern }));
  const knownPrompt: PatternPromptKnown[] = known.map(({ ref, pattern }) => ({
    ref,
    title: pattern.title,
    description: truncate(pattern.description, 200),
    kind: pattern.kind,
    status: pattern.status,
  }));

  const answer = await deps.llm.structured({
    system: buildPatternsSystem(),
    user: buildPatternsUser(prompt, knownPrompt),
    schemaName: SCHEMA_NAMES.patterns,
    jsonSchema: patternsJsonSchema,
    zod: PatternsSchema,
    purpose: 'patterns',
    tier: 'smart',
    signal: deps.signal,
  });

  const byRef = new Map(sources.map((source) => [source.ref, source]));
  const created: Pattern[] = [];
  const updated = new Map<ID, Pattern>();
  let skipped = 0;

  for (const draft of answer.data.patterns) {
    const title = clean(draft.title, MAX_TITLE_CHARS);
    const evidence = evidenceOf(draft, byRef);
    // A repetition needs two different days; one event is not a pattern.
    if (title === '' || distinctDays(evidence) < MIN_EVIDENCE_DAYS) {
      skipped++;
      continue;
    }

    const match = findKnown(draft, known);
    if (match?.pattern.status === 'rejected') {
      skipped++;
      continue;
    }
    if (match) {
      const next = await mergeInto(match.pattern, draft, evidence);
      if (next) {
        match.pattern = next;
        // A pattern created earlier in this very answer stays "created", with its latest state.
        const own = created.findIndex((pattern) => pattern.id === next.id);
        if (own >= 0) created[own] = next;
        else updated.set(next.id, next);
      }
      continue;
    }

    const pattern = await patternsRepo.create({
      title,
      description: clean(draft.description, MAX_DESCRIPTION_CHARS),
      kind: draft.kind,
      evidence,
      confidence: Math.min(normalizeUnit(draft.confidence, 0.4), capFor(evidence.length)),
      ...(clean(draft.suggestion, MAX_SUGGESTION_CHARS) !== '' && { suggestion: clean(draft.suggestion, MAX_SUGGESTION_CHARS) }),
      occurrences: evidence.length,
      firstSeenDay: evidence[0].day,
      lastSeenDay: evidence[evidence.length - 1].day,
    });
    created.push(pattern);
    // The next draft of the same answer may restate this one.
    known.push({ ref: `p${known.length + 1}`, pattern });
  }

  return { created, updated: [...updated.values()], skipped, examined: sources.length, usage: answer.usage };
}
