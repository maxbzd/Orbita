# Модель данных (контракт для всех модулей)

Хранилище: **IndexedDB через Dexie**. Все id — строки (UUID v4 или time-ordered), все даты — **ISO-строки в UTC** (`string`), кроме полей-дней `YYYY-MM-DD` в **локальной таймзоне пользователя**. Любая запись имеет `createdAt`, `updatedAt`; удаление мягкое (`deletedAt`), корзина чистится через 30 дней. Id глобально уникальны, а `updatedAt` задаёт «побеждает последний пишущий» — на этом держится опциональная облачная синхронизация ([CLOUD.md](CLOUD.md)).

Типы живут в `src/domain/types.ts`, схемы валидации (zod) — в `src/domain/schemas.ts`. Ниже — нормативное описание.

```ts
type ID = string;
type ISODate = string;      // 2026-10-07T12:30:00.000Z
type DayKey = string;       // 2026-10-07 (локальный день)

interface Base { id: ID; createdAt: ISODate; updatedAt: ISODate; deletedAt?: ISODate; isDemo?: boolean }

// ───────── Захват ─────────
type CaptureKind = 'voice' | 'text' | 'ai_chat' | 'checkin' | 'review_answer';
type CaptureContext = 'walk' | 'home' | 'transit' | 'work' | 'other';
type ProcessStatus = 'raw' | 'transcribing' | 'transcribed' | 'extracting' | 'review' | 'done' | 'failed' | 'skipped';

interface Capture extends Base {
  kind: CaptureKind;
  day: DayKey;                    // локальный день записи
  title?: string;                 // от ИИ или пользователя
  summary?: string;               // 1–2 предложения
  text: string;                   // текущий (правленый) транскрипт / введённый текст
  rawText?: string;               // исходный транскрипт без правок и глоссария
  audioId?: ID;                   // → AudioBlob
  durationSec?: number;
  context?: CaptureContext;
  projectIds: ID[];
  personIds: ID[];
  tags: string[];
  status: ProcessStatus;
  error?: string;                 // последняя ошибка обработки (для повтора)
  processedAt?: ISODate;
  pinned?: boolean;
  source?: { app?: string; url?: string; importedFrom?: 'chatgpt' | 'claude' | 'paste' | 'share' };
}

interface AudioBlob { id: ID; captureId: ID; mime: string; sizeBytes: number; data: Blob; chunks?: number; createdAt: ISODate }

// ───────── Объекты (полиморфная таблица items) ─────────
type ItemKind = 'decision' | 'commitment' | 'idea' | 'prediction' | 'task' | 'question' | 'lesson' | 'fact';
type ItemStatus = 'proposed' | 'active' | 'done' | 'dropped' | 'dismissed'; // proposed — ждёт разбора

interface ItemBase extends Base {
  kind: ItemKind;
  status: ItemStatus;
  title: string;                  // короткая формулировка (≤ 120 симв.)
  body?: string;                  // подробности
  captureId?: ID;                 // источник
  quote?: string;                 // дословная цитата-доказательство из записи
  quoteStart?: number;            // смещение в Capture.text для подсветки
  personIds: ID[];
  projectIds: ID[];
  tags: string[];
  confidence?: number;            // 0..1, уверенность извлечения
  duplicateOf?: ID;               // возможный дубль
  dueAt?: ISODate;                // срок/дата пересмотра — см. kind
  doneAt?: ISODate;
}

interface Decision extends ItemBase { kind: 'decision';
  question?: string; chosen: string; alternatives: string[]; reasons: string[]; expected?: string;
  reviewAt?: ISODate;             // = dueAt
  outcome?: { rating: 1|2|3|4|5; note: string; at: ISODate };   // как вышло
}
interface Commitment extends ItemBase { kind: 'commitment';
  direction: 'i_owe' | 'owed_to_me';
  counterpartyId?: ID;            // человек
  counterpartyName?: string;      // если человек ещё не создан
  // dueAt — срок
}
interface Idea extends ItemBase { kind: 'idea'; stage: 'spark' | 'exploring' | 'doing' | 'parked' | 'dropped'; relatedIds: ID[] }
interface Prediction extends ItemBase { kind: 'prediction';
  probability: number;            // 0..1 на момент записи
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

// ───────── Люди и проекты ─────────
// Роли прежних версий (student, parent, lead, teacher) читаются как other, family, client, mentor.
type PersonRole = 'partner' | 'teammate' | 'client' | 'friend' | 'family' | 'mentor' | 'other';
interface Person extends Base {
  name: string; aliases: string[]; role: PersonRole; notes?: string;
  lastMentionAt?: ISODate; mentionCount: number;
  relationMood?: number;          // −1..1, скользящая оценка по записям
  archived?: boolean;
}
interface Project extends Base {
  name: string; kind: 'business' | 'product' | 'study' | 'personal' | 'other';
  status: 'active' | 'paused' | 'done'; description?: string; keywords: string[]; color?: string;
}

// ───────── Состояние ─────────
interface CheckIn extends Base {
  at: ISODate; day: DayKey;
  valence: number;                // −1..1 (неприятно ↔ приятно)
  energy: number;                 // 0..1
  focus?: number; stress?: number;// 0..1
  tags: string[];                 // 'сон', 'работа', 'деньги', …
  note?: string;
  captureId?: ID;
  origin: 'manual' | 'ai_suggested' | 'ai_confirmed';
  sleepHours?: number;
}

// ───────── Паттерны, обзоры ─────────
interface Pattern extends Base {
  title: string; description: string;
  kind: 'behavior' | 'trigger' | 'recurring_topic' | 'time_of_day' | 'relationship' | 'decision_bias' | 'other';
  evidence: { captureId: ID; quote?: string; day: DayKey }[];
  confidence: number;             // 0..1
  status: 'candidate' | 'confirmed' | 'rejected' | 'resolved';
  suggestion?: string;            // что с этим делать
  firstSeenDay: DayKey; lastSeenDay: DayKey; occurrences: number;
}
type ReviewPeriod = 'day' | 'week' | 'month' | 'year';
interface Review extends Base {
  period: ReviewPeriod; startDay: DayKey; endDay: DayKey;
  headline: string;
  sections: { id: string; title: string; kind: 'stats'|'wins'|'overdue'|'patterns'|'people'|'calibration'|'mood'|'text'; body: string; data?: unknown }[];
  questions: string[];            // вопросы для рефлексии
  answers?: { question: string; answer: string; captureId?: ID }[];
  generatedBy: 'ai' | 'rules';
}

// ───────── Системное ─────────
interface Profile { id: 'me'; name: string; about: string; goals: string; values: string; talkStyle: string; glossary: { term: string; hint?: string }[]; updatedAt: ISODate }
interface Settings { id: 'settings'; /* ai, stt, theme, lock, locale, autoAccept, capture, privacy, onboarding: см. src/db/settings.ts */ }
interface UsageRow { id: ID; at: ISODate; provider: string; model: string; purpose: 'extract'|'review'|'patterns'|'ask'|'transcribe'|'test'; inputTokens: number; outputTokens: number; audioSec?: number; costUsd?: number }
interface ContextPackPreset { id: ID; name: string; sections: string[]; windowDays: number; personIds: ID[]; projectIds: ID[]; privacy: 'full' | 'initials' | 'anonymous'; maxTokens: number }
interface Link { id: ID; from: ID; to: ID; kind: 'related' | 'caused' | 'follows' | 'supersedes' | 'duplicate'; createdAt: ISODate }
interface Tombstone { id: ID; table: string; deletedAt: ISODate }
```

## Таблицы Dexie и индексы

| Таблица | Первичный ключ | Индексы |
|---|---|---|
| `captures` | `id` | `day`, `status`, `kind`, `createdAt`, `*personIds`, `*projectIds`, `*tags` |
| `audio` | `id` | `captureId` |
| `items` | `id` | `kind`, `status`, `[kind+status]`, `captureId`, `dueAt`, `*personIds`, `*projectIds`, `createdAt` |
| `people` | `id` | `name`, `role`, `lastMentionAt` |
| `projects` | `id` | `status` |
| `checkins` | `id` | `day`, `at` |
| `patterns` | `id` | `status`, `lastSeenDay` |
| `reviews` | `id` | `[period+startDay]` |
| `profile` | `id` | нет |
| `settings` | `id` | нет |
| `usage` | `id` | `at` |
| `presets` | `id` | нет |
| `links` | `id` | `from`, `to` |
| `tombstones` | `id` | `table` |

(Сервис синхронизации добавляет таблицу `syncmeta`, см. [CLOUD.md](CLOUD.md). Актуальный список — в `src/db/`.)

Миграции: `db.version(n).stores(...)` с функциями `upgrade`; каждая миграция покрыта тестом на «старых» данных.

## Инварианты

1. `Item.status === 'proposed'` — только у объектов, ещё не разобранных; разбор переводит в `active` (или `dismissed`).
2. Объект, созданный из записи, всегда держит `captureId` и по возможности `quote`.
3. Удаление записи не удаляет принятые объекты — они теряют ссылку, но остаются (с пометкой «источник удалён»).
4. `Person.mentionCount`, `lastMentionAt` пересчитываются при принятии/удалении записи, не вручную.
5. `Prediction.probability ∈ [0.01, 0.99]`; `outcome` задаёт `resolvedAt`.
6. Демо-данные имеют `isDemo: true` и удаляются одной операцией.
7. Все записи валидируются zod на границе (импорт, ответ ИИ), внутренние типы — только после валидации.

## Калибровка (производная, не хранится)

Для закрытых прогнозов с `outcome ∈ {true,false}`: Brier = mean((p − o)²); корзины по вероятности (0–10 %, 10–20 %, …) → доля сбывшихся. Показывать от 5 закрытых прогнозов, иначе «мало данных».
