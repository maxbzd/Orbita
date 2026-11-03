# Changelog

All notable changes to Orbita are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Upgraded the stack: React 19, Vite 8, TypeScript 7, Vitest 5, React Router 8 (`react-router`, with the v7 behaviours now the default), Motion 14.
- Encryption: new backups and locks use Argon2id (32 MiB, 3 passes) instead of PBKDF2, split with HKDF into separate keys for encrypting and for checking the password, with the data's purpose authenticated. An unlock is one key derivation instead of two. Old backups and locks still open, and a lock made by an earlier version upgrades itself on its next unlock. Argon2id is pure JavaScript and loads on first use, so the content policy needs no `wasm-unsafe-eval`.

### Added

- **Trusted Types.** The content policy now also requires them for scripts: the browser refuses any string that is about to become code (`innerHTML`, `eval`-like calls, a script or worker address). The one exception is a default policy (`public/tt-policy.js`) that lets through only script addresses on the app's own origin, which is what registering the service worker needs. Checked in Chromium across the screens and the vault flows: no violations. zod runs without compiling schemas (it probed `new Function` on every start).
- **Protect this device** (Settings): encryption at rest. With it on, nothing readable is ever written to the device: the database lives in memory while the app is open, and only sealed records (AES-256-GCM, each bound to its place, recordings included) go to an encrypted journal within a fraction of a second and whenever the app is left. The data key is wrapped by your password (Argon2id), a recovery key shown once, and optionally passkeys (Face ID, fingerprint, security key, through the WebAuthn PRF extension). It replaces the older app lock, which only guarded the entrance and the API keys. Locking reloads the page, which drops every plain value from memory; one window at a time. Verified in Chromium: before, 62 notes and names are readable in IndexedDB; after, none, and the plain database is gone.
- **Sync merges edits field by field.** When two devices change the same note or task while apart, the changes are merged instead of the later whole record replacing the other: different fields both survive, lists (tags, people) are combined, text edited in different places is merged word by word, and when the same field was changed on both the later edit wins. The device remembers the last version it shared with the cloud for this (rows over 150 KB skip it and fall back to the older "later record wins"). Orbita's server-side check and end-to-end encrypted cloud are not part of this change.
- On iPhone and iPad in a Safari tab, where the browser deletes a site's data after 7 idle days, the onboarding now explains it before anything is typed in and shows how to add the app to the Home Screen; the day screen reminds until it is installed.

## [1.0.0] - 2026-10-22

First open-source release.

### Added

- Seven interface languages: English, Spanish, German, French, Portuguese (Brazil), Ukrainian and Russian. English and Russian also cover the rule-based engine (extraction, search, questions), prompts for AI models and demo data; other languages fall back to English there, and a cloud model answers in the interface language. Spanish, German, French, Portuguese and Ukrainian are AI-drafted and open for native review. A small dependency-free translation layer, a language picker in Settings and onboarding, `npm run i18n:check`, and [a guide to adding languages](docs/I18N.md).
- Link previews: Open Graph and Twitter card metadata with a preview image.
- Hosting: a GitHub Pages workflow and a tag-triggered release workflow that attaches the static build.
- A neutral, fictional demo person (a freelance designer building a small product) in both languages, with two months of records, objects, patterns and reviews.
- English documentation, contribution guide, code of conduct, security policy, issue and pull request templates, CI.

### Changed

- The cloud sync is fully optional: with no Supabase project configured the app is entirely local and hides the online features. Project settings come from `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` at build time.
- Check-in factors, the glossary suggestions and the onboarding questions are general instead of tied to one profession.
- The roles of people are neutral: `partner`, `teammate`, `client`, `friend`, `family`, `mentor`, `other`. Data and backups with the old roles (`student`, `parent`, `lead`, `teacher`) are migrated automatically (database schema version 3).

### Removed

- All personal data, project identifiers and hosting references of the original author.
