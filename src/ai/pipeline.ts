import { NotFoundError, audioRepo, capturesRepo, itemsRepo, peopleRepo, profileRepo, projectsRepo, settingsRepo } from '../db';
import { localDayKey, nowISO } from '../domain/dates';
import { truncate } from '../domain/text';
import type { Capture, CheckIn, ID, Item, Person, Project, Settings } from '../domain/types';
import { applyMoodSuggestion } from './checkin-suggest';
import { resolveEntities } from './entities';
import type { AmbiguousMention, MergeSuggestion } from './entities';
import { NoKeyError, describeError, isAbortedError } from './errors';
import { normalizeTags, toItemDraft } from './extract-drafts';
import type { DraftContext, ItemDraft } from './extract-drafts';
import { mergeExtractions, splitText } from './parts';
import { EXTRACTION_LIMITS, buildExtractionSystem, buildExtractionUser } from './prompts/extraction';
import { ExtractionSchema, SCHEMA_NAMES, extractionJsonSchema } from './prompts/schemas';
import type { Extraction } from './prompts/schemas';
import type { LlmProvider, SttProvider, Usage } from './providers/types';
import { dedupeDrafts, findDuplicate, findRestatement } from './resolver';
import { restingStatus, transcribeCapture } from './transcribe';

/**
 * Capture → structure: `processCapture` is the one entry point the UI calls after a record is saved
 * (and again for "повторить" and "перепрогнать"). See docs/ARCHITECTURE.md "Извлечение (pipeline)".
 */

export interface ProcessDeps {
  llm: LlmProvider;
  /** Needed only for a record that has audio but no text yet. */
  stt?: SttProvider;
  /** Defaults to the stored settings. */
  settings?: Settings;
  /** The moment of processing ("today" for the model); tests pin it. */
  now?: Date;
  signal?: AbortSignal;
}

/**
 * - `review`: objects wait for the user's decision.
 * - `done`: nothing is left to decide (auto-accepted, or nothing was found).
 * - `skipped`: no speech or no text; there is nothing to extract.
 * - `waiting`: the record has audio but no recognizer was given; it stays as it is.
 */
export type ProcessOutcome = 'review' | 'done' | 'skipped' | 'waiting';

export interface PipelineUsage {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
}

export interface ProcessResult {
  outcome: ProcessOutcome;
  capture: Capture;
  /** Objects stored by this run, with their current statuses (auto-accepted ones are `active`). */
  items: Item[];
  autoAccepted: number;
  /** What the model found that was dropped as unsound (no title, hopeless confidence, repeats). */
  dropped: number;
  newPeople: Person[];
  newProjects: Project[];
  /** Names that match several people or projects: the user picks. */
  ambiguous: AmbiguousMention[];
  /** Newly created people or projects that look like existing ones. */
  mergeHints: MergeSuggestion[];
  /** The model's clarifying questions to the author. */
  questionsForUser: string[];
  /** The suggested state, if the author spoke about it. */
  mood?: CheckIn;
  /** The record was longer than the limit, its tail was not processed. */
  truncated: boolean;
  /** Tokens of this run; the provider writes the same numbers to the `usage` table. */
  usage: PipelineUsage;
}

const OPEN_ITEM_STATUSES = ['active'] as const;
const MAX_TAGS_FROM_MODEL = 6;
const TITLE_MAX = 60;

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;
const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

function addUsage(total: PipelineUsage, usage: Usage): PipelineUsage {
  return {
    requests: total.requests + 1,
    inputTokens: total.inputTokens + usage.inputTokens,
    outputTokens: total.outputTokens + usage.outputTokens,
    ...(usage.costUsd !== undefined || total.costUsd !== undefined ? { costUsd: (total.costUsd ?? 0) + (usage.costUsd ?? 0) } : {}),
  };
}

const emptyResult = (outcome: ProcessOutcome, capture: Capture): ProcessResult => ({
  outcome,
  capture,
  items: [],
  autoAccepted: 0,
  dropped: 0,
  newPeople: [],
  newProjects: [],
  ambiguous: [],
  mergeHints: [],
  questionsForUser: [],
  truncated: false,
  usage: { requests: 0, inputTokens: 0, outputTokens: 0 },
});

const running = new Map<ID, Promise<ProcessResult>>();

/**
 * Transcribes (when there is audio and no text yet), extracts, resolves people and projects, and stores the
 * objects as `proposed` for review. Safe to call again at any time:
 *  - a call while the same capture is already being processed returns that run;
 *  - a repeat replaces the capture's still-`proposed` objects; accepted, edited and dismissed ones stay,
 *    and the model's restatements of them are not proposed again;
 *  - nothing the user entered (a title, a confirmed state, links to people) is overwritten.
 *
 * Failures are saved on the capture (`failed` + a Russian message for the "повторить" button) and rethrown.
 * Cancelling and a missing API key are not failures: the capture goes back to where it was and waits.
 */
export function processCapture(captureId: ID, deps: ProcessDeps): Promise<ProcessResult> {
  const active = running.get(captureId);
  if (active) return active;
  const run = runPipeline(captureId, deps).finally(() => running.delete(captureId));
  running.set(captureId, run);
  return run;
}

async function runPipeline(captureId: ID, deps: ProcessDeps): Promise<ProcessResult> {
  let capture = await capturesRepo.get(captureId);
  if (!capture || capture.deletedAt) throw new NotFoundError('captures', captureId);
  const settings = deps.settings ?? (await settingsRepo.getSettings());

  // ───── Text: dictated, typed, or recognized from the recording.
  if (capture.text.trim() === '') {
    const audio = await audioRepo.getForCapture(captureId);
    if (!audio) return emptyResult('skipped', await capturesRepo.setStatus(captureId, 'skipped'));
    if (!deps.stt) return emptyResult('waiting', capture);
    capture = await transcribeCapture(captureId, { stt: deps.stt, settings, signal: deps.signal });
    if (capture.status === 'skipped' || capture.text.trim() === '') return emptyResult('skipped', capture);
  }

  const before = capture;
  const resting = restingStatus(before.status, 'transcribed');
  await capturesRepo.setStatus(captureId, 'extracting');
  try {
    const result = await extractAndStore(before, deps, settings);
    // «Хранить аудио» is off: the text is safe now, so the voice can go. A failed cleanup must not fail the job.
    if (!settings.capture.keepAudio) await audioRepo.remove(captureId).catch(() => undefined);
    return result;
  } catch (error) {
    if (isAbortedError(error) || error instanceof NoKeyError) {
      // Waiting for a key or for the user is not a failure; the record is where it was.
      await capturesRepo.setStatus(captureId, resting, resting === 'failed' ? { error: before.error } : {});
    } else {
      await capturesRepo.markFailed(captureId, describeError(error));
    }
    throw error;
  }
}

async function extractAndStore(capture: Capture, deps: ProcessDeps, settings: Settings): Promise<ProcessResult> {
  const today = localDayKey(deps.now ?? new Date());
  const [profile, everyPerson, everyProject, everyOpenItem, ownItems] = await Promise.all([
    profileRepo.get(),
    peopleRepo.list({ includeArchived: true }),
    projectsRepo.list(),
    itemsRepo.list({ status: OPEN_ITEM_STATUSES }),
    itemsRepo.listByCapture(capture.id),
  ]);
  // The demo set is a sandbox: a real record must not link to its people, projects or objects (removing the demo would cut those links).
  const isReal = capture.isDemo !== true;
  const real = <T extends { isDemo?: boolean }>(rows: T[]): T[] => (isReal ? rows.filter((row) => row.isDemo !== true) : rows);
  const allPeople = real(everyPerson);
  const allProjects = real(everyProject);
  const activeItems = real(everyOpenItem);

  // Open objects of other records: the model may point at one it repeats, and local similarity backs it up.
  const openItems = activeItems.filter((item) => item.captureId !== capture.id).slice(0, EXTRACTION_LIMITS.openItems);
  const openRefs = openItems.map((item, index) => ({ ref: `o${index + 1}`, kind: item.kind, title: item.title }));

  // ───── Model: one request per part of a long record.
  const { parts, truncated } = splitText(capture.text);
  const extractions: Extraction[] = [];
  let usage: PipelineUsage = { requests: 0, inputTokens: 0, outputTokens: 0 };
  for (const [index, part] of parts.entries()) {
    const answer = await deps.llm.structured({
      system: buildExtractionSystem(),
      user: buildExtractionUser({
        today,
        captureDay: capture.day,
        kind: capture.kind,
        captureContext: capture.context,
        profile,
        people: allPeople.filter((person) => !person.archived),
        projects: allProjects.filter((project) => project.status !== 'done'),
        openItems: openRefs,
        text: part,
        ...(parts.length > 1 && { part: { index: index + 1, total: parts.length } }),
      }),
      schemaName: SCHEMA_NAMES.extraction,
      jsonSchema: extractionJsonSchema,
      zod: ExtractionSchema,
      purpose: 'extract',
      tier: 'fast',
      signal: deps.signal,
    });
    extractions.push(answer.data);
    usage = addUsage(usage, answer.usage);
  }
  const extraction = mergeExtractions(extractions);

  // ───── People and projects.
  const entities = await resolveEntities(
    extraction,
    { people: allPeople, projects: allProjects },
    { updateRelationMood: capture.processedAt === undefined, ignoreNames: profile.name.trim() === '' ? [] : [profile.name], isDemo: capture.isDemo === true },
  );

  // ───── Objects.
  const context: DraftContext = {
    text: capture.text,
    captureDay: capture.day,
    personId: entities.personId,
    projectId: entities.projectId,
    openItemByRef: new Map(openItems.map((item, index) => [`o${index + 1}`, { id: item.id, kind: item.kind }])),
  };
  const built = extraction.items.map((item) => toItemDraft(item, context)).filter(isDefined);
  // What the user already settled for this record stays settled: no second proposal of the same thing.
  const settled = ownItems.filter((item) => item.status !== 'proposed');
  const fresh = dedupeDrafts(built).filter((draft) => !findRestatement(draft, settled));
  const drafts: ItemDraft[] = fresh.map((draft) => {
    const twin = draft.duplicateOf === undefined ? findDuplicate(draft, openItems) : undefined;
    return twin ? { ...draft, duplicateOf: twin.item.id } : draft;
  });
  const dropped = extraction.items.length - drafts.length;

  // Invariant 6: what grows out of a demo record is demo too, so that removing the demo leaves nothing behind.
  const stored = await itemsRepo.replaceProposed(capture.id, capture.isDemo ? drafts.map((draft) => ({ ...draft, isDemo: true })) : drafts);

  // ───── The record itself. A title the author or an earlier run set is kept; the summary follows the text.
  const title = capture.title?.trim() ? capture.title : truncate(extraction.title.replace(/\s+/g, ' ').trim(), TITLE_MAX);
  const summary = extraction.summary.replace(/\s+/g, ' ').trim();
  await capturesRepo.update(capture.id, {
    ...(title !== '' && { title }),
    ...(summary !== '' && { summary }),
    personIds: unique([...capture.personIds, ...entities.personIds]),
    projectIds: unique([...capture.projectIds, ...entities.projectIds]),
    tags: unique([...capture.tags, ...normalizeTags(extraction.tags, MAX_TAGS_FROM_MODEL)]),
    status: stored.length === 0 ? 'done' : 'review',
    processedAt: nowISO(),
    error: undefined,
  });
  const mood = await applyMoodSuggestion(capture, extraction.mood);

  // ───── Auto-accept: confident, not a suspected duplicate. The last accept settles the capture to `done`.
  let autoAccepted = 0;
  if (settings.autoAccept.enabled) {
    for (const item of stored) {
      if (item.duplicateOf === undefined && (item.confidence ?? 0) >= settings.autoAccept.minConfidence) {
        await itemsRepo.accept(item.id);
        autoAccepted++;
      }
    }
  }

  const final = (await capturesRepo.get(capture.id)) ?? capture;
  return {
    outcome: final.status === 'done' ? 'done' : 'review',
    capture: final,
    items: await itemsRepo.getMany(stored.map((item) => item.id)),
    autoAccepted,
    dropped: Math.max(0, dropped),
    newPeople: entities.newPeople,
    newProjects: entities.newProjects,
    ambiguous: entities.ambiguous,
    mergeHints: entities.mergeHints,
    questionsForUser: extraction.questionsForUser,
    ...(mood && { mood }),
    truncated,
    usage,
  };
}
