import { z } from 'zod';
import { COMMITMENT_DIRECTIONS, IDEA_STAGES, PATTERN_KINDS, PERSON_ROLES, PROJECT_KINDS, TASK_PRIORITIES } from '../../domain/types';
import { toModelJsonSchema } from '../jsonschema';

/**
 * What the model returns. Field names are English (they are part of the contract with the model),
 * the texts inside are in the language the system prompt asks for. Two rules keep the schemas friendly to every provider:
 *  - absent values are `null` (`.nullish()`), lists are always present (`.catch([])` also forgives `null`);
 *  - numbers are plain `z.number()`: the pipeline clamps them, so "70" for a probability is repaired
 *    rather than rejected.
 * The `.describe()` texts are what the model reads in the JSON Schema.
 */

/** A list of strings; anything else (null, a string, a missing key) is an empty list. */
const list = () => z.array(z.string()).catch([]);

/**
 * A list of objects. Missing or null is an empty list, but a malformed element is an error: a silent
 * `.catch([])` here would drop every object of the record because of one bad one. The error goes to the
 * automatic repair request instead.
 */
const objects = <T extends z.ZodType>(item: T) => z.preprocess((value) => value ?? [], z.array(item));

// ───────── Extraction ─────────

const itemBase = {
  title: z.string().describe('Short wording in the requested language, up to 100 characters'),
  body: z.string().nullish(),
  quote: z.string().nullish().describe('VERBATIM quote from the record (up to ~200 characters) or null'),
  confidence: z.number().describe('0..1'),
  people: list().describe('Names of people in the base form'),
  projects: list(),
  dueDate: z.string().nullish().describe('YYYY-MM-DD or null'),
  duplicateOf: z.string().nullish().describe('Code from the recent open objects (o3) or null'),
  tags: list(),
};

export const ExtractedItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('decision'),
    ...itemBase,
    question: z.string().nullish(),
    chosen: z.string().describe('What was chosen'),
    alternatives: list(),
    reasons: list(),
    expected: z.string().nullish(),
  }),
  z.object({
    kind: z.literal('commitment'),
    ...itemBase,
    direction: z.enum(COMMITMENT_DIRECTIONS).describe('i_owe — the author owes someone; owed_to_me — someone owes the author'),
    counterparty: z.string().nullish().describe('Name of the person in the base form'),
  }),
  z.object({
    kind: z.literal('idea'),
    ...itemBase,
    stage: z.enum(IDEA_STAGES).catch('spark'),
  }),
  z.object({
    kind: z.literal('prediction'),
    ...itemBase,
    probability: z.number().describe('0.01..0.99'),
  }),
  z.object({
    kind: z.literal('task'),
    ...itemBase,
    priority: z.enum(TASK_PRIORITIES).nullish().catch(null),
  }),
  z.object({ kind: z.literal('question'), ...itemBase }),
  z.object({ kind: z.literal('lesson'), ...itemBase }),
  z.object({
    kind: z.literal('fact'),
    ...itemBase,
    value: z.string().nullish(),
  }),
]);

export const ExtractedMoodSchema = z.object({
  valence: z.number().describe('−1 (very unpleasant) … 1 (very pleasant)'),
  energy: z.number().describe('0 (no strength) … 1 (lots of energy)'),
  focus: z.number().nullish(),
  stress: z.number().nullish(),
  tags: list(),
  note: z.string().nullish(),
  confidence: z.number().describe('0..1'),
  quote: z.string().nullish(),
});

export const ExtractedPersonSchema = z.object({
  name: z.string().describe('Name in the base form'),
  aliases: list(),
  role: z.enum(PERSON_ROLES).catch('other'),
  sentiment: z.number().nullish().describe('−1 … 1 or null'),
  note: z.string().nullish(),
});

export const ExtractedProjectSchema = z.object({
  name: z.string(),
  kind: z.enum(PROJECT_KINDS).catch('other'),
  keywords: list(),
});

export const ExtractionSchema = z.object({
  title: z.string().describe('Up to 60 characters'),
  summary: z.string().describe('1–2 sentences'),
  tags: list(),
  mood: ExtractedMoodSchema.nullish().catch(null).describe('null if the author does not talk about their state'),
  items: objects(ExtractedItemSchema),
  people: objects(ExtractedPersonSchema),
  projects: objects(ExtractedProjectSchema),
  questionsForUser: list(),
});

export type ExtractedItem = z.infer<typeof ExtractedItemSchema>;
export type ExtractedMood = z.infer<typeof ExtractedMoodSchema>;
export type ExtractedPerson = z.infer<typeof ExtractedPersonSchema>;
export type ExtractedProject = z.infer<typeof ExtractedProjectSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;

// ───────── Review ─────────

export const ReviewSchema = z.object({
  headline: z.string().describe('The main thought of the period in one phrase, up to 90 characters'),
  sections: objects(
    z.object({
      title: z.string().describe('Up to 40 characters'),
      body: z.string().describe('2–5 sentences; a list with “• ” is allowed'),
    }),
  ),
  questions: list().describe('2–3 reflection questions'),
});
export type ReviewDraft = z.infer<typeof ReviewSchema>;

// ───────── Patterns ─────────

export const PatternDraftSchema = z.object({
  existingId: z.string().nullish().describe('Code of a known pattern (p2) or null'),
  title: z.string().describe('Up to 70 characters'),
  description: z.string().describe('What repeats, 1–3 sentences'),
  kind: z.enum(PATTERN_KINDS).catch('other'),
  confidence: z.number().describe('0..1'),
  suggestion: z.string().nullish(),
  evidence: objects(
    z.object({
      ref: z.string().describe('Code of the record (c3)'),
      quote: z.string().nullish().describe('Verbatim quote or null'),
    }),
  ).describe('At least two records from different days'),
});

export const PatternsSchema = z.object({
  patterns: objects(PatternDraftSchema).describe('No more than 6'),
});
export type PatternDraft = z.infer<typeof PatternDraftSchema>;
export type PatternsResult = z.infer<typeof PatternsSchema>;

// ───────── JSON Schemas for the models ─────────

/** `schemaName` of each structured request; the mock provider recognizes its task by it. */
export const SCHEMA_NAMES = {
  extraction: 'orbit_extraction',
  review: 'orbit_review',
  patterns: 'orbit_patterns',
} as const;

export const extractionJsonSchema = toModelJsonSchema(ExtractionSchema);
export const reviewJsonSchema = toModelJsonSchema(ReviewSchema);
export const patternsJsonSchema = toModelJsonSchema(PatternsSchema);
