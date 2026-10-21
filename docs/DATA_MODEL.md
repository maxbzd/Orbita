# Data model (the contract for every module)

Storage: **IndexedDB through Dexie**. All ids are strings (UUID v4 or time-ordered). All dates are **UTC ISO strings**, except the day fields
`YYYY-MM-DD`, which are in the user's **local time zone**. Every record has `createdAt` and `updatedAt`; deletion is soft (`deletedAt`) and the
trash is emptied after 30 days. Ids are globally unique and `updatedAt` drives last-writer-wins, which is what makes the optional cloud sync ([CLOUD.md](CLOUD.md)) possible.

Types live in `src/domain/types.ts`, validation schemas (zod) in `src/domain/schemas.ts`. The normative description follows.

```ts
type ID = string;
type ISODate = string;      // 2026-10-07T12:30:00.000Z
type DayKey = string;       // 2026-10-07 (a local day)

interface Base { id: ID; createdAt: ISODate; updatedAt: ISODate; deletedAt?: ISODate; isDemo?: boolean }

// ───────── Capture ─────────
type CaptureKind = 'voice' | 'text' | 'ai_chat' | 'checkin' | 'review_answer';
type CaptureContext = 'walk' | 'home' | 'transit' | 'work' | 'other';
type ProcessStatus = 'raw' | 'transcribing' | 'transcribed' | 'extracting' | 'review' | 'done' | 'failed' | 'skipped';

interface Capture extends Base {
  kind: CaptureKind;
  day: DayKey;                    // the local day of the note
  title?: string;                 // from the AI or the user
  summary?: string;               // 1-2 sentences
  text: string;                   // the current (edited) transcript / typed text
  rawText?: string;               // the original transcript, before edits and the glossary
  audioId?: ID;                   // → AudioBlob
  durationSec?: number;
  context?: CaptureContext;
  projectIds: ID[];
  personIds: ID[];
  tags: string[];
  status: ProcessStatus;
  error?: string;                 // the last processing error (for a retry)
  processedAt?: ISODate;
  pinned?: boolean;
  source?: { app?: string; url?: string; importedFrom?: 'chatgpt' | 'claude' | 'paste' | 'share' };
}

interface AudioBlob { id: ID; captureId: ID; mime: string; sizeBytes: number; data: Blob; chunks?: number; createdAt: ISODate }

// ───────── Objects (the polymorphic table `items`) ─────────
type ItemKind = 'decision' | 'commitment' | 'idea' | 'prediction' | 'task' | 'question' | 'lesson' | 'fact';
type ItemStatus = 'proposed' | 'active' | 'done' | 'dropped' | 'dismissed'; // proposed: waiting for review

interface ItemBase extends Base {
  kind: ItemKind;
  status: ItemStatus;
  title: string;                  // a short wording (≤ 120 chars)
  body?: string;                  // details
  captureId?: ID;                 // the source
  quote?: string;                 // a verbatim evidence quote from the note
  quoteStart?: number;            // offset in Capture.text for highlighting
  personIds: ID[];
  projectIds: ID[];
  tags: string[];
  confidence?: number;            // 0..1, extraction confidence
  duplicateOf?: ID;               // a possible duplicate
  dueAt?: ISODate;                // due date / review date, depending on the kind
  doneAt?: ISODate;
}

interface Decision extends ItemBase { kind: 'decision';
  question?: string; chosen: string; alternatives: string[]; reasons: string[]; expected?: string;
  reviewAt?: ISODate;             // = dueAt
  outcome?: { rating: 1|2|3|4|5; note: string; at: ISODate };   // how it turned out
}
interface Commitment extends ItemBase { kind: 'commitment';
  direction: 'i_owe' | 'owed_to_me';
  counterpartyId?: ID;            // a person
  counterpartyName?: string;      // when the person has not been created yet
  // dueAt is the deadline
}
interface Idea extends ItemBase { kind: 'idea'; stage: 'spark' | 'exploring' | 'doing' | 'parked' | 'dropped'; relatedIds: ID[] }
interface Prediction extends ItemBase { kind: 'prediction';
  probability: number;            // 0..1 at the time of the note
  resolvesAt?: ISODate;           // = dueAt
  outcome?: 'true' | 'false' | 'unknown';
  resolvedAt?: ISODate;
  resolutionNote?: string;
}
interface Task extends ItemBase { kind: 'task'; priority?: 'low'|'normal'|'high'; scheduledFor?: DayKey }
interface Question extends ItemBase { kind: 'question'; answer?: string }
interface Lesson extends ItemBase { kind: 'lesson' }
interface Fact extends ItemBase { kind: 'fact'; value?: string; validFrom?: ISODate; supersededBy?: ID }
type Item = Decision | Commitment | Idea | Prediction | Task | Question | Lesson | Fact;

// ───────── People and projects ─────────
// Roles of earlier versions (student, parent, lead, teacher) are read as other, family, client, mentor.
type PersonRole = 'partner' | 'teammate' | 'client' | 'friend' | 'family' | 'mentor' | 'other';
interface Person extends Base {
  name: string; aliases: string[]; role: PersonRole; notes?: string;
  lastMentionAt?: ISODate; mentionCount: number;
  relationMood?: number;          // −1..1, a moving estimate from the notes
  archived?: boolean;
}
interface Project extends Base {
  name: string; kind: 'business' | 'product' | 'study' | 'personal' | 'other';
  status: 'active' | 'paused' | 'done'; description?: string; keywords: string[]; color?: string;
}

// ───────── Mood ─────────
interface CheckIn extends Base {
  at: ISODate; day: DayKey;
  valence: number;                // −1..1 (unpleasant ↔ pleasant)
  energy: number;                 // 0..1
  focus?: number; stress?: number;// 0..1
  tags: string[];                 // 'sleep', 'study', 'money', ...
  note?: string;
  captureId?: ID;
  origin: 'manual' | 'ai_suggested' | 'ai_confirmed';
  sleepHours?: number;
}

// ───────── Patterns and reviews ─────────
interface Pattern extends Base {
  title: string; description: string;
  kind: 'behavior' | 'trigger' | 'recurring_topic' | 'time_of_day' | 'relationship' | 'decision_bias' | 'other';
  evidence: { captureId: ID; quote?: string; day: DayKey }[];
  confidence: number;             // 0..1
  status: 'candidate' | 'confirmed' | 'rejected' | 'resolved';
  suggestion?: string;            // what to do about it
  firstSeenDay: DayKey; lastSeenDay: DayKey; occurrences: number;
}
type ReviewPeriod = 'day' | 'week' | 'month' | 'year';
interface Review extends Base {
  period: ReviewPeriod; startDay: DayKey; endDay: DayKey;
  headline: string;
  sections: { id: string; title: string; kind: 'stats'|'wins'|'overdue'|'patterns'|'people'|'calibration'|'mood'|'text'; body: string; data?: unknown }[];
  questions: string[];            // reflection questions
  answers?: { question: string; answer: string; captureId?: ID }[];
  generatedBy: 'ai' | 'rules';
}

// ───────── System ─────────
interface Profile { id: 'me'; name: string; about: string; goals: string; values: string; talkStyle: string; glossary: { term: string; hint?: string }[]; updatedAt: ISODate }
interface Settings { id: 'settings'; /* ai, stt, theme, lock, locale, autoAccept, capture, privacy, onboarding: see src/db/settings.ts */ }
interface UsageRow { id: ID; at: ISODate; provider: string; model: string; purpose: 'extract'|'review'|'patterns'|'ask'|'transcribe'|'test'; inputTokens: number; outputTokens: number; audioSec?: number; costUsd?: number }
interface ContextPackPreset { id: ID; name: string; sections: string[]; windowDays: number; personIds: ID[]; projectIds: ID[]; privacy: 'full' | 'initials' | 'anonymous'; maxTokens: number }
interface Link { id: ID; from: ID; to: ID; kind: 'related' | 'caused' | 'follows' | 'supersedes' | 'duplicate'; createdAt: ISODate }
interface Tombstone { id: ID; table: string; deletedAt: ISODate }
```

## Dexie tables and indexes

| Table | Primary key | Indexes |
|---|---|---|
| `captures` | `id` | `day`, `status`, `kind`, `createdAt`, `*personIds`, `*projectIds`, `*tags` |
| `audio` | `id` | `captureId` |
| `items` | `id` | `kind`, `status`, `[kind+status]`, `captureId`, `dueAt`, `*personIds`, `*projectIds`, `createdAt` |
| `people` | `id` | `name`, `role`, `lastMentionAt` |
| `projects` | `id` | `status` |
| `checkins` | `id` | `day`, `at` |
| `patterns` | `id` | `status`, `lastSeenDay` |
| `reviews` | `id` | `[period+startDay]` |
| `profile` | `id` | none |
| `settings` | `id` | none |
| `usage` | `id` | `at` |
| `presets` | `id` | none |
| `links` | `id` | `from`, `to` |
| `tombstones` | `id` | `table` |

(The sync service adds a `syncmeta` table; see [CLOUD.md](CLOUD.md). The authoritative list is `src/db/`.)

Migrations: `db.version(n).stores(...)` with `upgrade` functions; every migration is covered by a test on "old" data.

## Invariants

1. `Item.status === 'proposed'` only for objects not yet reviewed; review moves them to `active` (or `dismissed`).
2. An object created from a note always keeps `captureId` and, where possible, `quote`.
3. Deleting a note does not delete accepted objects: they lose the link but stay (marked "source deleted").
4. `Person.mentionCount` and `lastMentionAt` are recomputed when a note is accepted or deleted, never by hand.
5. `Prediction.probability ∈ [0.01, 0.99]`; setting `outcome` sets `resolvedAt`.
6. Demo data has `isDemo: true` and is removed by one operation.
7. Everything is validated with zod at the boundary (import, an AI reply); internal types are trusted only after validation.

## Calibration (derived, not stored)

For resolved predictions with `outcome ∈ {true,false}`: Brier = mean((p − o)²); probability buckets (0-10 %, 10-20 %, ...) → the share that came true.
Shown from 5 resolved predictions, otherwise "not enough data".
