# Архитектура

## Стек

- **Vite 6 + React 18 + TypeScript (strict)**, ES-модули, без SSR.
- **Роутинг:** `react-router-dom` v6, `createHashRouter` (работает на любом статическом хостинге и в ярлыках PWA: `#/capture?autostart=1`).
- **Данные:** `dexie` + `dexie-react-hooks` (`useLiveQuery`) — реактивные запросы по IndexedDB. Локальное состояние интерфейса — `zustand` (только эфемерное: открыта ли запись, ход обработки).
- **Валидация:** `zod`.
- **Поиск:** `minisearch` (префиксный и нечёткий, русская и английская нормализация: нижний регистр, `ё→е`, стоп-слова).
- **Анимация:** `motion` для переходов и жестов; тяжёлые эффекты — Canvas 2D (`Orb`: около 1200 точек по сфере Фибоначчи, спрайты точек), без WebGL и three.js (проще, и нет риска потери контекста на iOS).
- **Графики и орбиты:** вручную SVG, без библиотек графиков.
- **PWA:** `vite-plugin-pwa` (precache, офлайн, manifest, ярлыки, share_target).
- **Тесты:** `vitest` + `fake-indexeddb` + `@testing-library/react` (юнит и компоненты). `playwright` нужен только для `npm run screenshots` (картинки для документации), с уже установленным Chromium.
- **Стили:** CSS Modules и глобальные CSS-переменные (токены в `src/styles/tokens.css` и `themes.css`). Tailwind не используем: визуальный язык свой (стекло, аура, орбиты).
- **Шрифты:** встроены локально (`@fontsource/*`), латиница и кириллица: Cormorant Garamond (display-serif от 28 px), Literata (текстовый serif), Onest (интерфейс), Unbounded (только обложки итогов и числа паспорта), JetBrains Mono (числа, статусы, mono-капс). Никаких сторонних CDN в рантайме (приватность и офлайн).
- **i18n:** маленький слой без зависимостей (`src/i18n`), английский текст — ключ. См. [I18N.md](I18N.md).

## Структура репозитория

```
/                      package.json, vite.config.ts, tsconfig*.json, index.html
docs/                  PRODUCT, DATA_MODEL, ARCHITECTURE, DESIGN, CLOUD, DEPLOY, I18N (+ ru/, img/)
public/                иконки PWA
scripts/               i18n-check, генерация иконок, скриншоты для документации
supabase/migrations/   серверная схема для опциональной облачной синхронизации
src/
  main.tsx  App.tsx  routes.tsx
  domain/              типы, zod-схемы, чистые функции (калибровка, даты, имена, сходство)
  db/                  схема Dexie, миграции, репозитории (captures, items, people, …), демо-данные, резервные копии, крипто
  ai/                  провайдеры (anthropic, openai-compat, ручной через буфер, mock), промпты, конвейер извлечения,
                       resolver (люди/проекты/дубли), обзоры, паттерны, ask (RAG-lite), контекст-пак
  audio/               запись (MediaRecorder + куски + восстановление), уровень громкости, провайдеры STT
  search/              индекс MiniSearch, разбор запроса, нормализация
  sync/                опциональная облачная синхронизация: движок, адаптер Supabase, сервис
  i18n/                t(), tn(), pick(), locales/ru.json
  state/               zustand-сторы (эфемерное)
  ui/                  дизайн-система: Aura, Orb, Glass, Button, Chip, Sheet, Nav, Sparkline, орбит-примитивы…
  features/
    onboarding/  today/  capture/  review-extraction/  stream/  capture-detail/  checkin/
    orbit/       items/ (обязательства, решения, прогнозы, идеи, задачи, вопросы, уроки, факты)
    people/      patterns/  reviews/  ask/  context/  me/  settings/  lock/
  styles/              tokens.css, themes.css, effects.css, global.css
```

**Правила границ:**
1. `domain/` не знает про React и Dexie. `db/` не знает про React. `ai/` не знает про React и общается с хранилищем через репозитории из `db/`.
2. Папка фичи экспортирует только `index.ts` (корневые роуты и компоненты); внутренние файлы другие фичи не импортируют. Общее — в `ui/`, `domain/`, `db/`, `ai/`.
3. Компоненты фич не ходят в Dexie напрямую, только через `db/repos` и хуки `db/hooks`.
4. Сеть — только в `ai/`, `audio/` (распознавание речи) и `sync/`; всё остальное работает офлайн.
5. Каждая фича отдаёт роуты как `export const routes: RouteObject[]`; `routes.tsx` собирает их лениво.

## Слой ИИ

```ts
interface LlmProvider {
  id: 'anthropic' | 'openai-compat' | 'manual';
  structured<T>(req: { system: string; user: string; schemaName: string; jsonSchema: object; zod: ZodType<T>; maxTokens?: number; model?: string; signal?: AbortSignal; purpose: UsagePurpose }): Promise<{ data: T; usage: Usage }>;
  chat(req: { system: string; messages: Msg[]; model?: string; signal?: AbortSignal; purpose: UsagePurpose; onToken?(t: string): void }): Promise<{ text: string; usage: Usage }>;
  test(): Promise<{ ok: boolean; message: string }>;
}
interface SttProvider { id: 'browser' | 'openai-compat'; transcribe(blob: Blob, opts: { lang: string; prompt?: string; signal?: AbortSignal }): Promise<{ text: string; durationSec?: number }> }
```

- **Anthropic:** `POST https://api.anthropic.com/v1/messages`, заголовки `x-api-key`, `anthropic-version: 2023-06-01`, `anthropic-dangerous-direct-browser-access: true`. Структурный вывод через `tools` + `tool_choice: {type:'tool', name}`. Модели по умолчанию: быстрая (извлечение, ask) и умная (обзоры, паттерны); обе настраиваются.
- **OpenAI-совместимый:** `POST {baseUrl}/chat/completions`, `response_format: {type:'json_schema'}` с откатом на `json_object` + zod; транскрибация — `POST {baseUrl}/audio/transcriptions` (`whisper-1`, `gpt-4o-mini-transcribe`, Groq `whisper-large-v3-turbo`).
- **Manual (буфер обмена):** `structured()` не ходит в сеть; интерфейс показывает собранный промпт, принимает вставленный JSON, разбирает и валидирует тем же zod.
- **Mock:** детерминированный правиловый провайдер (`providers/mock*.ts`) для офлайна, тестов и `VITE_MOCK_AI=1`. Понимает русский и английский.
- Любой ответ модели считается **недоверенным**: строгий разбор, вырезание ```json-обёрток, zod, ровно одна автопочинка (вторым запросом с описанием ошибки), иначе статус `failed` с понятным сообщением и кнопкой «повторить». Ничего из ответа модели не выполняется и не выводится как HTML.
- Таймауты и отмена (`AbortController`), повтор при 429/5xx с экспоненциальной паузой (макс. 3), понятные локализованные сообщения об ошибках (нет ключа / неверный ключ / лимит / офлайн / CORS).
- После каждого вызова пишется строка в `usage`.
- **Промпты зависят от языка** (`src/ai/prompts/*`, через `pick(en, ru)`), чтобы модель отвечала на языке интерфейса.

## Извлечение (конвейер)

`processCapture(captureId)`: транскрипт → (опц.) глоссарий → контекст для модели (профиль + известные люди и проекты + недавние открытые объекты для дублей) → `structured(ExtractionSchema)` → `resolve()` (люди/проекты/дубли) → запись объектов со статусом `proposed` → `Capture.status = 'review'` (или `done` при автопринятии). Идемпотентно: повтор заменяет ещё не принятые `proposed`-объекты этой записи, принятые не трогает.

## Аудио

`MediaRecorder` (предпочтительно `audio/webm;codecs=opus`, на Safari `audio/mp4`), `timeslice` 10 с; куски сразу пишутся в IndexedDB (`audio` + `chunks`), поэтому сбой или закрытая вкладка не теряют запись. При старте приложение ищет незавершённые записи и предлагает восстановить. Уровень громкости — `AnalyserNode`. Живая диктовка — `SpeechRecognition` (если есть) с языковым тегом локали интерфейса. На время записи удерживается Wake Lock, если доступен.

## Безопасность и приватность

- Ключи API хранятся в IndexedDB `settings`; при включённой блокировке шифруются AES-GCM ключом из пароля (PBKDF2, ≥ 210 000 итераций, соль на устройство). Пароль не хранится, только проверочный хэш.
- Шифрованная копия использует тот же механизм; формат `orbit-backup-v1` (JSON + base64 аудио).
- CSP в `index.html`: `default-src 'self'`; `connect-src` — только хосты ИИ и Supabase; без `unsafe-eval`. CSP в `<meta>` в рантайме можно только ужесточить, поэтому собственный OpenAI-совместимый сервер нужно добавить в `connect-src` до сборки (место отмечено комментарием).
- Контекст-пак уважает уровень приватности (`full | initials | anonymous`): подмена имён детерминированная в пределах одного экспорта.
- Нигде нет аналитики, телеметрии и внешних шрифтов.
- Политики строк (RLS) в опциональном облаке: см. [CLOUD.md](CLOUD.md).

## Производительность

- Ленивые роуты, код-сплиттинг по фичам. `Orb` — Canvas 2D (60 к/с в записи, 30 в покое, 15 в «режиме прогулки»); при `prefers-reduced-motion` или на слабом устройстве — CSS-сфера. Уровни «Эффекты: Авто / Максимум / Сниженные / Минимум» в настройках.
- `backdrop-filter` ограничен: не более 2–3 слоёв стекла на экран, на слабых устройствах (`deviceMemory ≤ 2` / `prefers-reduced-transparency`) заменяется полупрозрачной заливкой.
- Длинные списки потока работают окнами; поиску не нужен воркер примерно до 20 тысяч объектов.

## Качество

- `npm run check` = типы + проверка переводов + тесты + сборка; CI запускает то же на каждый пуш и pull request.
- Набор тестов идёт в **русской** локали (исходный язык) с фиксированным часовым поясом; английское поведение покрывают отдельные тесты, которые переключают локаль и возвращают её.
- `VITE_MOCK_AI=1` включает детерминированные mock-LLM и STT для тестов, демо и скриншотов без ключей.

## Развёртывание

`vite build` → статическая папка `dist/` (`base: './'`). См. [DEPLOY.md](DEPLOY.md).
