# Architecture

## Stack

- **Vite 6 + React 18 + TypeScript (strict)**, ES modules, no SSR.
- **Routing:** `react-router-dom` v6 with `createHashRouter` (works on any static host and in PWA shortcuts such as `#/capture?autostart=1`).
- **Data:** `dexie` + `dexie-react-hooks` (`useLiveQuery`): reactive queries over IndexedDB. Local UI state is `zustand` (ephemeral only: is a recording open, processing progress).
- **Validation:** `zod`.
- **Search:** `minisearch` (prefix + fuzzy, with Russian and English normalisation: lower case, `ё→е`, stop words).
- **Animation:** `motion` for transitions and gestures; heavy effects are Canvas 2D (`Orb`: about 1200 points on a Fibonacci sphere, point sprites), no WebGL and no three.js (simpler, and no risk of losing the context on iOS).
- **Charts and orbits:** hand-written SVG, no chart library.
- **PWA:** `vite-plugin-pwa` (precache, offline, manifest, shortcuts, share target).
- **Tests:** `vitest` + `fake-indexeddb` + `@testing-library/react` (unit and component). `playwright` is used only by `npm run screenshots` (documentation images), with a preinstalled Chromium.
- **Styles:** CSS Modules + global CSS variables (design tokens in `src/styles/tokens.css` and `themes.css`). No Tailwind: the visual language is custom (glass, aura, orbits).
- **Fonts:** bundled locally (`@fontsource/*`) with Latin and Cyrillic subsets: Cormorant Garamond (display serif from 28 px), Literata (text serif), Onest (UI), Unbounded (only year-summary covers and passport numbers), JetBrains Mono (numbers, statuses, mono caps). No third-party CDN at runtime (privacy + offline).
- **i18n:** a small dependency-free layer (`src/i18n`), English text as the key. See [I18N.md](I18N.md).

## Repository structure

```
/                      package.json, vite.config.ts, tsconfig*.json, index.html
docs/                  PRODUCT, DATA_MODEL, ARCHITECTURE, DESIGN, CLOUD, DEPLOY, I18N (+ ru/, img/)
public/                PWA icons
scripts/               i18n-check, icon generation, documentation screenshots
supabase/migrations/   server schema for the optional cloud sync
src/
  main.tsx  App.tsx  routes.tsx
  domain/              types, zod schemas, pure functions (calibration, dates, names, similarity)
  db/                  Dexie schema, migrations, repositories (captures, items, people, ...), demo seed, backup, crypto
  ai/                  providers (anthropic, openai-compat, manual copy-paste, mock), prompts, extraction pipeline,
                       resolver (people/projects/duplicates), reviews, patterns, ask (RAG-lite), context pack
  audio/               recording (MediaRecorder + chunks + recovery), level meter, speech-to-text providers
  search/              MiniSearch index, query parsing, normalisation
  sync/                optional cloud sync: engine, Supabase adapter, service
  i18n/                t(), tn(), pick(), locales/ru.json
  state/               zustand stores (ephemeral)
  ui/                  design system: Aura, Orb, Glass, Button, Chip, Sheet, Nav, Sparkline, orbit primitives...
  features/
    onboarding/  today/  capture/  review-extraction/  stream/  capture-detail/  checkin/
    orbit/       items/ (commitments, decisions, predictions, ideas, tasks, questions, lessons, facts)
    people/      patterns/  reviews/  ask/  context/  me/  settings/  lock/
  styles/              tokens.css, themes.css, effects.css, global.css
```

**Boundary rules:**
1. `domain/` knows neither React nor Dexie. `db/` knows no React. `ai/` knows no React and reaches storage through the repositories in `db/`.
2. A feature folder exports only its `index.ts` (root routes and components); other features do not import its internals. Shared code lives in `ui/`, `domain/`, `db/`, `ai/`.
3. Feature components never touch Dexie directly, only `db/repos` and the hooks in `db/hooks`.
4. The network is used only in `ai/`, `audio/` (speech-to-text) and `sync/`; everything else works offline.
5. Each feature exposes its routes as `export const routes: RouteObject[]`; `routes.tsx` assembles them lazily.

## The AI layer

```ts
interface LlmProvider {
  id: 'anthropic' | 'openai-compat' | 'manual';
  structured<T>(req: { system: string; user: string; schemaName: string; jsonSchema: object; zod: ZodType<T>; maxTokens?: number; model?: string; signal?: AbortSignal; purpose: UsagePurpose }): Promise<{ data: T; usage: Usage }>;
  chat(req: { system: string; messages: Msg[]; model?: string; signal?: AbortSignal; purpose: UsagePurpose; onToken?(t: string): void }): Promise<{ text: string; usage: Usage }>;
  test(): Promise<{ ok: boolean; message: string }>;
}
interface SttProvider { id: 'browser' | 'openai-compat'; transcribe(blob: Blob, opts: { lang: string; prompt?: string; signal?: AbortSignal }): Promise<{ text: string; durationSec?: number }> }
```

- **Anthropic:** `POST https://api.anthropic.com/v1/messages` with `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`. Structured output through `tools` + `tool_choice: {type:'tool', name}`. Default models: a fast one for extraction and ask, a smarter one for reviews and patterns; both are configurable.
- **OpenAI-compatible:** `POST {baseUrl}/chat/completions` with `response_format: {type:'json_schema'}`, falling back to `json_object` + zod. Transcription: `POST {baseUrl}/audio/transcriptions` (`whisper-1`, `gpt-4o-mini-transcribe`, Groq `whisper-large-v3-turbo`).
- **Manual (clipboard):** `structured()` does not touch the network; the UI shows the assembled prompt, accepts a pasted JSON, then parses and validates it with the same zod schema.
- **Mock:** a deterministic rule-based provider (`providers/mock*.ts`) used offline, in tests and with `VITE_MOCK_AI=1`. It understands English and Russian.
- Every model reply is **untrusted**: strict parsing, stripping of ```json fences, zod, exactly one auto-repair (a second request describing the error), otherwise status `failed` with a clear message and a retry button. Nothing from a model reply is ever executed or interpreted as HTML.
- Timeouts and cancellation (`AbortController`), retries on 429/5xx with exponential back-off (max 3), clear localized errors (no key / bad key / rate limit / offline / CORS).
- A `usage` row is written after every call.
- **Prompts are per language** (`src/ai/prompts/*`, built with `pick(en, ru)`) so the model answers in the interface language.

## Extraction pipeline

`processCapture(captureId)`: transcript → (optional) glossary → context for the model (profile + known people/projects + recent open objects for duplicates) → `structured(ExtractionSchema)` → `resolve()` (people/projects/duplicates) → objects written with status `proposed` → `Capture.status = 'review'` (or `done` with auto-accept). Idempotent: a re-run replaces the not-yet-accepted `proposed` objects of that note and never touches accepted ones.

## Audio

`MediaRecorder` (preferably `audio/webm;codecs=opus`, `audio/mp4` on Safari) with a 10 s `timeslice`; chunks go to IndexedDB (`audio` + `chunks`) at once, so a crash or a closed tab does not lose the recording. On start the app looks for unfinished recordings and offers to recover them. The level meter is an `AnalyserNode`. Live dictation uses `SpeechRecognition` when present, with the language tag of the interface locale. A Wake Lock is held during recording when available.

## Security and privacy

- API keys are stored in IndexedDB `settings`; with the lock enabled they are encrypted with AES-GCM using a key derived from the password (PBKDF2, at least 210 000 iterations, a per-device salt). The password is never stored, only a verification hash.
- Encrypted backup uses the same mechanism; format `orbit-backup-v1` (JSON + base64 audio).
- CSP in `index.html`: `default-src 'self'`; `connect-src` lists only the AI hosts and Supabase; no `unsafe-eval`. A `<meta>` CSP can only be tightened, never loosened, at runtime, so a self-hosted OpenAI-compatible server must be added to `connect-src` before building (the place is marked with a comment).
- The context pack respects the privacy level (`full | initials | anonymous`): names are replaced deterministically within one export.
- No analytics, telemetry or external fonts anywhere.
- Row-level security on the optional cloud, see [CLOUD.md](CLOUD.md).

## Performance

- Lazy routes, code splitting per feature. `Orb` is Canvas 2D (60 fps while recording, 30 idle, 15 in "walking mode"); with `prefers-reduced-motion` or on a weak device it falls back to a CSS sphere. Quality tiers "Effects: Auto / Maximum / Reduced / Minimum" in Settings.
- `backdrop-filter` is limited: at most 2-3 glass layers per screen; on weak devices (`deviceMemory ≤ 2` / `prefers-reduced-transparency`) it is replaced with a translucent fill.
- Long lists in the stream are windowed; the search index needs no worker up to roughly 20k objects.

## Quality

- `npm run check` = typecheck + i18n check + tests + build; CI runs the same on every push and pull request.
- The suite runs in the **Russian** locale (the original language) with a fixed time zone; English behaviour is covered by dedicated tests that switch the locale and restore it.
- `VITE_MOCK_AI=1` switches on a deterministic mock LLM/STT for tests, demos and screenshots without any keys.

## Deployment

`vite build` produces a static `dist/` folder (`base: './'`). See [DEPLOY.md](DEPLOY.md).
