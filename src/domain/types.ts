/**
 * Domain types. Normative source: docs/DATA_MODEL.md — do not rename fields.
 * Enumerations are declared as const tuples so zod schemas and UI can iterate them;
 * the derived unions are exactly the ones in the contract.
 */

export type ID = string;
/** ISO-8601 in UTC, e.g. `2026-10-07T12:30:00.000Z`. */
export type ISODate = string;
/** Local calendar day `YYYY-MM-DD` in the user's time zone. */
export type DayKey = string;

export interface Base {
  id: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
  deletedAt?: ISODate;
  isDemo?: boolean;
}

// ───────── Capture ─────────

export const CAPTURE_KINDS = ['voice', 'text', 'ai_chat', 'checkin', 'review_answer'] as const;
export type CaptureKind = (typeof CAPTURE_KINDS)[number];

export const CAPTURE_CONTEXTS = ['walk', 'home', 'transit', 'work', 'other'] as const;
export type CaptureContext = (typeof CAPTURE_CONTEXTS)[number];

export const PROCESS_STATUSES = [
  'raw',
  'transcribing',
  'transcribed',
  'extracting',
  'review',
  'done',
  'failed',
  'skipped',
] as const;
export type ProcessStatus = (typeof PROCESS_STATUSES)[number];

export const IMPORT_SOURCES = ['chatgpt', 'claude', 'paste', 'share'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export interface CaptureSource {
  app?: string;
  url?: string;
  importedFrom?: ImportSource;
}

/** A user's note pinned to a second of the recording ("Добавить пометку на 0:14"). */
export interface CaptureMark {
  id: ID;
  /** Seconds from the start of the recording. */
  at: number;
  text: string;
  createdAt: ISODate;
}

export interface Capture extends Base {
  kind: CaptureKind;
  /** Local day of the capture. */
  day: DayKey;
  title?: string;
  /** 1–2 sentences. */
  summary?: string;
  /** Current (edited) transcript or typed text. */
  text: string;
  /** Original transcript without edits and glossary corrections. */
  rawText?: string;
  audioId?: ID;
  durationSec?: number;
  context?: CaptureContext;
  projectIds: ID[];
  personIds: ID[];
  tags: string[];
  status: ProcessStatus;
  /** Last processing error, kept for retry. */
  error?: string;
  processedAt?: ISODate;
  pinned?: boolean;
  source?: CaptureSource;
  /** Time-anchored notes of the author, oldest position first. */
  marks?: CaptureMark[];
}

export interface AudioBlob {
  id: ID;
  captureId: ID;
  mime: string;
  sizeBytes: number;
  data: Blob;
  chunks?: number;
  createdAt: ISODate;
}

/**
 * One MediaRecorder chunk, written right away so a crash does not lose the recording.
 * Addition to the contract (ARCHITECTURE mentions `audio` + `chunks`, DATA_MODEL had no table).
 */
export interface AudioChunk {
  id: ID;
  captureId: ID;
  /** 0-based order of the chunk within the recording. */
  seq: number;
  mime: string;
  data: Blob;
  createdAt: ISODate;
}

// ───────── Items (polymorphic `items` table) ─────────

export const ITEM_KINDS = [
  'decision',
  'commitment',
  'idea',
  'prediction',
  'task',
  'question',
  'lesson',
  'fact',
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** `proposed` waits for the user's review. */
export const ITEM_STATUSES = ['proposed', 'active', 'done', 'dropped', 'dismissed'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export interface ItemBase extends Base {
  kind: ItemKind;
  status: ItemStatus;
  /** Short wording, at most 120 characters. */
  title: string;
  body?: string;
  /** Source capture. */
  captureId?: ID;
  /** Verbatim evidence from the capture text. */
  quote?: string;
  /** Offset into `Capture.text` for highlighting. */
  quoteStart?: number;
  personIds: ID[];
  projectIds: ID[];
  tags: string[];
  /** 0..1, extraction confidence. */
  confidence?: number;
  /** Possible duplicate of another item. */
  duplicateOf?: ID;
  /** Deadline / review date, see each kind. */
  dueAt?: ISODate;
  doneAt?: ISODate;
  /**
   * Addition to the contract (invariant 3): the source capture was permanently deleted,
   * `captureId` is cleared and the UI shows "источник удалён".
   */
  sourceDeleted?: boolean;
}

export const DECISION_RATINGS = [1, 2, 3, 4, 5] as const;
export type DecisionRating = (typeof DECISION_RATINGS)[number];

export interface DecisionOutcome {
  rating: DecisionRating;
  note: string;
  at: ISODate;
}

export interface Decision extends ItemBase {
  kind: 'decision';
  question?: string;
  chosen: string;
  alternatives: string[];
  reasons: string[];
  expected?: string;
  /** Same as `dueAt`. */
  reviewAt?: ISODate;
  /** How it turned out. */
  outcome?: DecisionOutcome;
}

export const COMMITMENT_DIRECTIONS = ['i_owe', 'owed_to_me'] as const;
export type CommitmentDirection = (typeof COMMITMENT_DIRECTIONS)[number];

export interface Commitment extends ItemBase {
  kind: 'commitment';
  direction: CommitmentDirection;
  counterpartyId?: ID;
  /** Used while the person is not created yet. */
  counterpartyName?: string;
}

export const IDEA_STAGES = ['spark', 'exploring', 'doing', 'parked', 'dropped'] as const;
export type IdeaStage = (typeof IDEA_STAGES)[number];

export interface Idea extends ItemBase {
  kind: 'idea';
  stage: IdeaStage;
  relatedIds: ID[];
}

export const PREDICTION_OUTCOMES = ['true', 'false', 'unknown'] as const;
export type PredictionOutcome = (typeof PREDICTION_OUTCOMES)[number];

export interface Prediction extends ItemBase {
  kind: 'prediction';
  /** 0.01..0.99 at the time of recording. */
  probability: number;
  /** Same as `dueAt`. */
  resolvesAt?: ISODate;
  outcome?: PredictionOutcome;
  resolvedAt?: ISODate;
  resolutionNote?: string;
}

export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface Task extends ItemBase {
  kind: 'task';
  priority?: TaskPriority;
  scheduledFor?: DayKey;
}

export interface Question extends ItemBase {
  kind: 'question';
  answer?: string;
}

export interface Lesson extends ItemBase {
  kind: 'lesson';
}

export interface Fact extends ItemBase {
  kind: 'fact';
  value?: string;
  validFrom?: ISODate;
  supersededBy?: ID;
}

export type Item = Decision | Commitment | Idea | Prediction | Task | Question | Lesson | Fact;

/** Narrows `Item` to one kind: `ItemOfKind<'decision'>` is `Decision`. */
export type ItemOfKind<K extends ItemKind> = Extract<Item, { kind: K }>;

// ───────── People and projects ─────────

export const PERSON_ROLES = [
  'student',
  'parent',
  'lead',
  'teacher',
  'partner',
  'teammate',
  'client',
  'friend',
  'family',
  'mentor',
  'other',
] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];

export interface Person extends Base {
  name: string;
  aliases: string[];
  role: PersonRole;
  notes?: string;
  lastMentionAt?: ISODate;
  mentionCount: number;
  /** −1..1, moving estimate across captures. */
  relationMood?: number;
  archived?: boolean;
}

export const PROJECT_KINDS = ['business', 'product', 'study', 'personal', 'other'] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const PROJECT_STATUSES = ['active', 'paused', 'done'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export interface Project extends Base {
  name: string;
  kind: ProjectKind;
  status: ProjectStatus;
  description?: string;
  keywords: string[];
  color?: string;
}

// ───────── Check-ins ─────────

export const CHECKIN_ORIGINS = ['manual', 'ai_suggested', 'ai_confirmed'] as const;
export type CheckInOrigin = (typeof CHECKIN_ORIGINS)[number];

export interface CheckIn extends Base {
  at: ISODate;
  day: DayKey;
  /** −1..1, unpleasant ↔ pleasant. */
  valence: number;
  /** 0..1. */
  energy: number;
  /** 0..1. */
  focus?: number;
  /** 0..1. */
  stress?: number;
  tags: string[];
  note?: string;
  captureId?: ID;
  origin: CheckInOrigin;
  sleepHours?: number;
}

// ───────── Patterns and reviews ─────────

export const PATTERN_KINDS = [
  'behavior',
  'trigger',
  'recurring_topic',
  'time_of_day',
  'relationship',
  'decision_bias',
  'other',
] as const;
export type PatternKind = (typeof PATTERN_KINDS)[number];

export const PATTERN_STATUSES = ['candidate', 'confirmed', 'rejected', 'resolved'] as const;
export type PatternStatus = (typeof PATTERN_STATUSES)[number];

export interface PatternEvidence {
  captureId: ID;
  quote?: string;
  day: DayKey;
}

export interface Pattern extends Base {
  title: string;
  description: string;
  kind: PatternKind;
  evidence: PatternEvidence[];
  /** 0..1. */
  confidence: number;
  status: PatternStatus;
  /** What to do about it. */
  suggestion?: string;
  firstSeenDay: DayKey;
  lastSeenDay: DayKey;
  occurrences: number;
}

export const REVIEW_PERIODS = ['day', 'week', 'month', 'year'] as const;
export type ReviewPeriod = (typeof REVIEW_PERIODS)[number];

export const REVIEW_SECTION_KINDS = [
  'stats',
  'wins',
  'overdue',
  'patterns',
  'people',
  'calibration',
  'mood',
  'text',
] as const;
export type ReviewSectionKind = (typeof REVIEW_SECTION_KINDS)[number];

export interface ReviewSection {
  id: string;
  title: string;
  kind: ReviewSectionKind;
  body: string;
  data?: unknown;
}

export interface ReviewAnswer {
  question: string;
  answer: string;
  captureId?: ID;
}

export interface Review extends Base {
  period: ReviewPeriod;
  startDay: DayKey;
  endDay: DayKey;
  headline: string;
  sections: ReviewSection[];
  /** Reflection questions. */
  questions: string[];
  answers?: ReviewAnswer[];
  generatedBy: 'ai' | 'rules';
}

// ───────── Profile ─────────

export interface GlossaryEntry {
  term: string;
  hint?: string;
}

export interface Profile {
  id: 'me';
  name: string;
  about: string;
  goals: string;
  values: string;
  talkStyle: string;
  glossary: GlossaryEntry[];
  updatedAt: ISODate;
}

// ───────── Settings ─────────

export const AI_PROVIDERS = ['anthropic', 'openai-compat', 'manual'] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const STT_PROVIDERS = ['browser', 'openai-compat'] as const;
export type SttProviderId = (typeof STT_PROVIDERS)[number];

export const THEME_MODES = ['auto', 'dark', 'light'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Visual-effects tier the user picked (`auto` follows the device). Mirrors `EffectsPreference` in styles/theme. */
export const EFFECTS_MODES = ['auto', 'max', 'reduced', 'min'] as const;
export type EffectsMode = (typeof EFFECTS_MODES)[number];

export const LOCK_KINDS = ['password', 'pin'] as const;
export type LockKind = (typeof LOCK_KINDS)[number];

export const PRIVACY_LEVELS = ['full', 'initials', 'anonymous'] as const;
export type PrivacyLevel = (typeof PRIVACY_LEVELS)[number];

/** AES-GCM payload whose key is derived from a password with PBKDF2. All binary fields are base64. */
export interface SealedData {
  v: 1;
  alg: 'AES-GCM';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  data: string;
}

export interface AiModels {
  /** Cheap and fast: extraction, ask. */
  fast: string;
  /** Smarter: reviews, patterns. */
  smart: string;
}

export interface AiSettings {
  provider: AiProviderId;
  anthropic: { apiKey: string; models: AiModels };
  /** Any OpenAI-compatible server (OpenAI, Groq, OpenRouter, …). */
  openaiCompat: { apiKey: string; baseUrl: string; models: AiModels };
}

export interface SttSettings {
  provider: SttProviderId;
  /** Used with `openai-compat`. */
  baseUrl: string;
  /** Empty means "reuse the OpenAI-compatible LLM key". */
  apiKey: string;
  model: string;
  /** BCP-47 language hint, e.g. `ru`. */
  language: string;
}

export interface LockSettings {
  enabled: boolean;
  /** What the user typed to set the lock up: decides the keyboard on the lock screen; the check is the same. */
  kind: LockKind;
  /** Base64 salt and iteration count of the password hash. */
  salt: string;
  iterations: number;
  /** Base64 password check value. The password itself is never stored. */
  verifier: string;
  autoLockMinutes: number;
  /**
   * API keys encrypted with the password while the lock is on (plain key fields are then empty).
   * The plaintext is the JSON `{ "v": 1, "anthropic": "<key>", "openaiCompat": "<key>", "stt": "<key>" }`
   * sealed with `sealText(password, …)`; see `features/lock/secrets.ts`.
   */
  sealedSecrets: SealedData | null;
}

export interface Settings {
  id: 'settings';
  ai: AiSettings;
  stt: SttSettings;
  theme: ThemeMode;
  lock: LockSettings;
  locale: { language: string };
  autoAccept: { enabled: boolean; minConfidence: number };
  capture: {
    defaultContext: CaptureContext | null;
    keepAudio: boolean;
    /** Walk mode: the screen goes dark during a long recording. */
    walkMode: boolean;
  };
  /** Looks: stored here (the source of truth), cached by ThemeProvider in localStorage for the first paint. */
  ui: { effects: EffectsMode; reduceMotion: boolean };
  privacy: { contextLevel: PrivacyLevel; previewBeforeSend: boolean };
  onboarding: { done: boolean; completedAt?: ISODate };
}

// ───────── System ─────────

export const USAGE_PURPOSES = ['extract', 'review', 'patterns', 'ask', 'transcribe', 'test'] as const;
export type UsagePurpose = (typeof USAGE_PURPOSES)[number];

export interface UsageRow {
  id: ID;
  at: ISODate;
  provider: string;
  model: string;
  purpose: UsagePurpose;
  inputTokens: number;
  outputTokens: number;
  audioSec?: number;
  costUsd?: number;
}

export interface ContextPackPreset {
  id: ID;
  name: string;
  sections: string[];
  windowDays: number;
  personIds: ID[];
  projectIds: ID[];
  privacy: PrivacyLevel;
  maxTokens: number;
}

export const LINK_KINDS = ['related', 'caused', 'follows', 'supersedes', 'duplicate'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export interface Link {
  id: ID;
  from: ID;
  to: ID;
  kind: LinkKind;
  createdAt: ISODate;
}

/** Cloud sync bookkeeping, local only: `id` is `table:recordId`, `audio:captureId`, `@cursor` or `@user`. */
export interface SyncMeta {
  id: string;
  v: string;
}

export interface Tombstone {
  id: ID;
  table: string;
  deletedAt: ISODate;
}
