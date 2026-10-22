# Contributing to Orbita

Thank you for wanting to help. Orbita is a small, opinionated app: local-first, private by default, fast on a phone
and calm to use. Contributions that keep to that spirit are very welcome: bug reports, fixes, features, translations, docs.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Getting started

Requirements: Node.js 22.23.4 or newer (earlier 22.x releases have known security fixes; any 24.22.1+ or 26.12.1+ works too).

```bash
git clone https://github.com/maxbzd/Orbita.git
cd Orbita
npm install
npm run dev            # http://localhost:5173
```

Open **Settings → Data → Demo data** (or choose it in the onboarding) to look around a made-up person's two months of records.
Nothing needs to be configured: an AI key, the cloud and speech-to-text servers are all optional. For a fully offline AI-free tour run
`VITE_MOCK_AI=1 npm run dev` (a deterministic stand-in model).

## Before you open a pull request

```bash
npm run check          # typecheck + i18n check + tests + build
```

All of it must pass; CI runs the same. Tips:

- `npm run test:watch` for a fast loop, `npx vitest run src/ai` for a folder.
- The suite runs in the **Russian** locale (the app's original language) with a fixed time zone. Tests of English behavior call
  `setLocale('en')` and restore `'ru'` afterwards (see `src/__tests__/english-ui.test.tsx`). New behavior of the rule-based engine
  (`src/ai/providers/mock-extract.ts`, `src/search`) should be tested in both languages.
- Date-dependent tests must not depend on the day they run: freeze "now" (`vi.useFakeTimers({ toFake: ['Date'] })`).

## Translations (i18n)

Every user-visible string goes through `t()`. **The English text is the key**; other languages live in JSON dictionaries.

- Write `t('Sign in')`, `t('Hello, {name}', { name })`, `tn(n, '{n} day', '{n} days')`. Keys must be string literals.
- Module-level constants use `msg('…')` and are translated with `t(value)` where they are shown.
- Add the Russian text to `src/i18n/locales/ru.json`, then run `npm run i18n:check`. It fails if a message is missing or its placeholders differ.
- Do not build sentences from fragments: translators need the whole sentence with placeholders.
- A new language is a JSON file plus a few lines: see [docs/I18N.md](docs/I18N.md).

## Code guidelines

- TypeScript, strict. Prefer small pure functions in `src/domain/` with unit tests; keep screens thin.
- Local-first is a hard rule: the UI reads and writes IndexedDB; the network is only ever a background copy.
- Privacy is a hard rule: nothing leaves the device unless the person set it up, and secrets never enter backups or sync.
- Match the surrounding style (naming, comment density, idiom). Comments explain *why*, in English.
- No new runtime dependency without a good reason.
- Layer boundaries are described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): `domain/` knows no React or Dexie; `ai/` talks to storage through repositories.

## Commits and pull requests

- Keep a pull request focused on one change. Describe what changed and why; include screenshots for UI changes.
- Use clear commit messages in the imperative: "Fix review window across the year boundary".
- Add or update tests with the change, and docs if behavior changes.

## Reporting bugs and proposing features

Use the issue templates. For a bug, include the steps, what you expected, what happened, your browser or device, and whether you used the demo data.
For a feature, describe the problem first; a short note on how it fits "local-first, private, calm" helps a lot.
