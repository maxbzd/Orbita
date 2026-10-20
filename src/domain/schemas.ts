import { z } from 'zod';
import {
  AI_PROVIDERS,
  CAPTURE_CONTEXTS,
  CAPTURE_KINDS,
  CHECKIN_ORIGINS,
  COMMITMENT_DIRECTIONS,
  DECISION_RATINGS,
  IDEA_STAGES,
  IMPORT_SOURCES,
  ITEM_KINDS,
  ITEM_STATUSES,
  LINK_KINDS,
  PATTERN_KINDS,
  PATTERN_STATUSES,
  PERSON_ROLES,
  PREDICTION_OUTCOMES,
  PRIVACY_LEVELS,
  PROCESS_STATUSES,
  PROJECT_KINDS,
  PROJECT_STATUSES,
  REVIEW_PERIODS,
  REVIEW_SECTION_KINDS,
  STT_PROVIDERS,
  TASK_PRIORITIES,
  THEME_MODES,
  EFFECTS_MODES,
  LOCK_KINDS,
  USAGE_PURPOSES,
} from './types';
import type {
  Capture,
  CheckIn,
  ContextPackPreset,
  Item,
  Link,
  Pattern,
  Person,
  Profile,
  Project,
  Review,
  SealedData,
  Settings,
  Tombstone,
  UsageRow,
} from './types';

/**
 * Zod v4 schemas matching docs/DATA_MODEL.md. Every entity schema is checked against its
 * hand-written type with `satisfies z.ZodType<T>`, so the two cannot drift apart.
 * Shared pieces stay free of transforms so they work with `z.toJSONSchema`.
 */

// ───────── Primitives ─────────

export const idSchema = z.string().min(1);
/** UTC instant, `new Date().toISOString()` shape. */
export const isoDateSchema = z.iso.datetime();
/** Local calendar day, `YYYY-MM-DD`. */
export const dayKeySchema = z.iso.date();
const unit = z.number().min(0).max(1);
const signedUnit = z.number().min(-1).max(1);
const idList = z.array(idSchema);
const tagList = z.array(z.string());

export const captureKindSchema = z.enum(CAPTURE_KINDS);
export const captureContextSchema = z.enum(CAPTURE_CONTEXTS);
export const processStatusSchema = z.enum(PROCESS_STATUSES);
export const itemKindSchema = z.enum(ITEM_KINDS);
export const itemStatusSchema = z.enum(ITEM_STATUSES);
export const personRoleSchema = z.enum(PERSON_ROLES);
export const projectKindSchema = z.enum(PROJECT_KINDS);
export const projectStatusSchema = z.enum(PROJECT_STATUSES);
export const patternKindSchema = z.enum(PATTERN_KINDS);
export const patternStatusSchema = z.enum(PATTERN_STATUSES);
export const reviewPeriodSchema = z.enum(REVIEW_PERIODS);
export const privacyLevelSchema = z.enum(PRIVACY_LEVELS);
export const usagePurposeSchema = z.enum(USAGE_PURPOSES);
export const linkKindSchema = z.enum(LINK_KINDS);

const baseShape = {
  id: idSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  deletedAt: isoDateSchema.optional(),
  isDemo: z.boolean().optional(),
};

// ───────── Capture ─────────

export const captureSchema = z.object({
  ...baseShape,
  kind: captureKindSchema,
  day: dayKeySchema,
  title: z.string().optional(),
  summary: z.string().optional(),
  text: z.string(),
  rawText: z.string().optional(),
  audioId: idSchema.optional(),
  durationSec: z.number().min(0).optional(),
  context: captureContextSchema.optional(),
  projectIds: idList,
  personIds: idList,
  tags: tagList,
  status: processStatusSchema,
  error: z.string().optional(),
  processedAt: isoDateSchema.optional(),
  pinned: z.boolean().optional(),
  source: z
    .object({
      app: z.string().optional(),
      url: z.string().optional(),
      importedFrom: z.enum(IMPORT_SOURCES).optional(),
    })
    .optional(),
  marks: z
    .array(z.object({ id: idSchema, at: z.number().min(0), text: z.string(), createdAt: isoDateSchema }))
    .optional(),
}) satisfies z.ZodType<Capture>;

// ───────── Items ─────────

/** `Item.title` limit from the contract. */
export const ITEM_TITLE_MAX = 120;

const itemBaseShape = {
  ...baseShape,
  status: itemStatusSchema,
  title: z.string().min(1).max(ITEM_TITLE_MAX),
  body: z.string().optional(),
  captureId: idSchema.optional(),
  quote: z.string().optional(),
  quoteStart: z.number().int().min(0).optional(),
  personIds: idList,
  projectIds: idList,
  tags: tagList,
  confidence: unit.optional(),
  duplicateOf: idSchema.optional(),
  dueAt: isoDateSchema.optional(),
  doneAt: isoDateSchema.optional(),
  sourceDeleted: z.boolean().optional(),
};

export const decisionSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('decision'),
  question: z.string().optional(),
  chosen: z.string(),
  alternatives: z.array(z.string()),
  reasons: z.array(z.string()),
  expected: z.string().optional(),
  reviewAt: isoDateSchema.optional(),
  outcome: z
    .object({
      rating: z.literal(DECISION_RATINGS),
      note: z.string(),
      at: isoDateSchema,
    })
    .optional(),
});

export const commitmentSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('commitment'),
  direction: z.enum(COMMITMENT_DIRECTIONS),
  counterpartyId: idSchema.optional(),
  counterpartyName: z.string().optional(),
});

export const ideaSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('idea'),
  stage: z.enum(IDEA_STAGES),
  relatedIds: idList,
});

export const PREDICTION_PROBABILITY_MIN = 0.01;
export const PREDICTION_PROBABILITY_MAX = 0.99;

export const predictionSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('prediction'),
  probability: z.number().min(PREDICTION_PROBABILITY_MIN).max(PREDICTION_PROBABILITY_MAX),
  resolvesAt: isoDateSchema.optional(),
  outcome: z.enum(PREDICTION_OUTCOMES).optional(),
  resolvedAt: isoDateSchema.optional(),
  resolutionNote: z.string().optional(),
});

export const taskSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('task'),
  priority: z.enum(TASK_PRIORITIES).optional(),
  scheduledFor: dayKeySchema.optional(),
});

export const questionSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('question'),
  answer: z.string().optional(),
});

export const lessonSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('lesson'),
});

export const factSchema = z.object({
  ...itemBaseShape,
  kind: z.literal('fact'),
  value: z.string().optional(),
  validFrom: isoDateSchema.optional(),
  supersededBy: idSchema.optional(),
});

export const itemSchema = z.discriminatedUnion('kind', [
  decisionSchema,
  commitmentSchema,
  ideaSchema,
  predictionSchema,
  taskSchema,
  questionSchema,
  lessonSchema,
  factSchema,
]) satisfies z.ZodType<Item>;

// ───────── People and projects ─────────

export const personSchema = z.object({
  ...baseShape,
  name: z.string().min(1),
  aliases: z.array(z.string()),
  role: personRoleSchema,
  notes: z.string().optional(),
  lastMentionAt: isoDateSchema.optional(),
  mentionCount: z.number().int().min(0),
  relationMood: signedUnit.optional(),
  archived: z.boolean().optional(),
}) satisfies z.ZodType<Person>;

export const projectSchema = z.object({
  ...baseShape,
  name: z.string().min(1),
  kind: projectKindSchema,
  status: projectStatusSchema,
  description: z.string().optional(),
  keywords: z.array(z.string()),
  color: z.string().optional(),
}) satisfies z.ZodType<Project>;

// ───────── Check-ins, patterns, reviews ─────────

export const checkInSchema = z.object({
  ...baseShape,
  at: isoDateSchema,
  day: dayKeySchema,
  valence: signedUnit,
  energy: unit,
  focus: unit.optional(),
  stress: unit.optional(),
  tags: tagList,
  note: z.string().optional(),
  captureId: idSchema.optional(),
  origin: z.enum(CHECKIN_ORIGINS),
  sleepHours: z.number().min(0).max(24).optional(),
}) satisfies z.ZodType<CheckIn>;

export const patternSchema = z.object({
  ...baseShape,
  title: z.string().min(1),
  description: z.string(),
  kind: patternKindSchema,
  evidence: z.array(
    z.object({
      captureId: idSchema,
      quote: z.string().optional(),
      day: dayKeySchema,
    }),
  ),
  confidence: unit,
  status: patternStatusSchema,
  suggestion: z.string().optional(),
  firstSeenDay: dayKeySchema,
  lastSeenDay: dayKeySchema,
  occurrences: z.number().int().min(0),
}) satisfies z.ZodType<Pattern>;

export const reviewSchema = z.object({
  ...baseShape,
  period: reviewPeriodSchema,
  startDay: dayKeySchema,
  endDay: dayKeySchema,
  headline: z.string(),
  sections: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      kind: z.enum(REVIEW_SECTION_KINDS),
      body: z.string(),
      data: z.unknown().optional(),
    }),
  ),
  questions: z.array(z.string()),
  answers: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
        captureId: idSchema.optional(),
      }),
    )
    .optional(),
  generatedBy: z.enum(['ai', 'rules']),
}) satisfies z.ZodType<Review>;

// ───────── Profile, usage, presets, links ─────────

export const profileSchema = z.object({
  id: z.literal('me'),
  name: z.string(),
  about: z.string(),
  goals: z.string(),
  values: z.string(),
  talkStyle: z.string(),
  glossary: z.array(z.object({ term: z.string(), hint: z.string().optional() })),
  updatedAt: isoDateSchema,
}) satisfies z.ZodType<Profile>;

export const usageRowSchema = z.object({
  id: idSchema,
  at: isoDateSchema,
  provider: z.string(),
  model: z.string(),
  purpose: usagePurposeSchema,
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  audioSec: z.number().min(0).optional(),
  costUsd: z.number().min(0).optional(),
}) satisfies z.ZodType<UsageRow>;

export const presetSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  sections: z.array(z.string()),
  windowDays: z.number().int().min(1),
  personIds: idList,
  projectIds: idList,
  privacy: privacyLevelSchema,
  maxTokens: z.number().int().min(1),
}) satisfies z.ZodType<ContextPackPreset>;

export const linkSchema = z.object({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  kind: linkKindSchema,
  createdAt: isoDateSchema,
}) satisfies z.ZodType<Link>;

export const tombstoneSchema = z.object({
  id: idSchema,
  table: z.string().min(1),
  deletedAt: isoDateSchema,
}) satisfies z.ZodType<Tombstone>;

// ───────── Settings ─────────

/** PBKDF2 limits shared by the lock and encrypted backups (see db/crypto.ts). */
export const PBKDF2_MIN_ITERATIONS = 210_000;
export const PBKDF2_MAX_ITERATIONS = 10_000_000;

export const sealedDataSchema = z.object({
  v: z.literal(1),
  alg: z.literal('AES-GCM'),
  kdf: z.literal('PBKDF2-SHA256'),
  iterations: z.number().int().min(PBKDF2_MIN_ITERATIONS).max(PBKDF2_MAX_ITERATIONS),
  salt: z.string().min(1),
  iv: z.string().min(1),
  data: z.string(),
}) satisfies z.ZodType<SealedData>;

const modelsSchema = (fast: string, smart: string) =>
  section(z.object({ fast: z.string().catch(fast), smart: z.string().catch(smart) }));

/** Missing or malformed nested object → `{}`, so every leaf below falls back to its default. */
function section<T extends z.ZodType>(schema: T) {
  return z.preprocess((value) => (typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}), schema);
}

/**
 * Every leaf carries its default via `.catch`, so `settingsSchema.parse(anything)` never throws:
 * missing or invalid values (or a non-object root) become defaults, unknown keys are dropped.
 * `settingsSchema.parse({})` is the canonical default settings object.
 */
export const settingsSchema = section(
  z.object({
    id: z.literal('settings').catch('settings'),
    ai: section(
      z.object({
        provider: z.enum(AI_PROVIDERS).catch('anthropic'),
        anthropic: section(
          z.object({
            apiKey: z.string().catch(''),
            models: modelsSchema('claude-haiku-5-5', 'claude-sonnet-5-5'),
          }),
        ),
        openaiCompat: section(
          z.object({
            apiKey: z.string().catch(''),
            baseUrl: z.string().catch('https://api.openai.com/v1'),
            models: modelsSchema('gpt-4o-mini', 'gpt-4o'),
          }),
        ),
      }),
    ),
    stt: section(
      z.object({
        provider: z.enum(STT_PROVIDERS).catch('browser'),
        baseUrl: z.string().catch('https://api.openai.com/v1'),
        apiKey: z.string().catch(''),
        model: z.string().catch('whisper-1'),
        language: z.string().catch('ru'),
      }),
    ),
    theme: z.enum(THEME_MODES).catch('dark'),
    lock: section(
      z.object({
        enabled: z.boolean().catch(false),
        kind: z.enum(LOCK_KINDS).catch('password'),
        salt: z.string().catch(''),
        iterations: z.number().int().min(0).catch(0),
        verifier: z.string().catch(''),
        autoLockMinutes: z.number().int().min(0).max(1440).catch(5),
        sealedSecrets: sealedDataSchema.nullable().catch(null),
      }),
    ),
    locale: section(z.object({ language: z.string().min(1).catch('ru') })),
    autoAccept: section(
      z.object({
        enabled: z.boolean().catch(false),
        minConfidence: unit.catch(0.85),
      }),
    ),
    capture: section(
      z.object({
        defaultContext: captureContextSchema.nullable().catch(null),
        keepAudio: z.boolean().catch(true),
        walkMode: z.boolean().catch(true),
      }),
    ),
    ui: section(
      z.object({
        effects: z.enum(EFFECTS_MODES).catch('auto'),
        reduceMotion: z.boolean().catch(false),
      }),
    ),
    privacy: section(
      z.object({
        contextLevel: privacyLevelSchema.catch('full'),
        previewBeforeSend: z.boolean().catch(false),
      }),
    ),
    onboarding: section(
      z.object({
        done: z.boolean().catch(false),
        completedAt: isoDateSchema.optional().catch(undefined),
      }),
    ),
  }),
) satisfies z.ZodType<Settings>;
