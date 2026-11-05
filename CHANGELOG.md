# Changelog

All notable changes to Orbita are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed

- Upgraded the stack: React 19, Vite 8, TypeScript 7, Vitest 5, React Router 8 (`react-router`, with the v7 behaviours now the default), Motion 14.
- Encryption: new backups and locks use Argon2id (32 MiB, 3 passes) instead of PBKDF2, split with HKDF into separate keys for encrypting and for checking the password, with the data's purpose authenticated. An unlock is one key derivation instead of two. Old backups and locks still open, and a lock made by an earlier version upgrades itself on its next unlock. Argon2id is pure JavaScript and loads on first use, so the content policy needs no `wasm-unsafe-eval`.

### Fixed

- On a 320 px screen, German suggested questions on the Ask screen pushed the page 74 px wider than the screen, and the period switch of the reviews was up to 25 px too wide in Spanish, French, Portuguese and Russian. Long chips now shorten with an ellipsis, and the segments give up some padding on the narrowest phones. The browser audit (`npm run e2e:audit`, in CI) now opens the screens at 320 px in all seven languages and fails on any sideways overflow.

### Added

- **Licences are checked and shipped.** `npm run check:licenses` (in CI) fails when a production dependency is under a licence that is not on a short permissive list (GPL, AGPL and "unknown" stop the build until someone decides on purpose). `public/third-party-licenses.txt` carries the notice of every production dependency next to the app, as the MIT, Apache and font licences ask; `npm run licenses -- --check` keeps it current. `npm run check:docs` (in CI) fails on a broken relative link in any Markdown file.
- **A compatibility guard** (`npm run check:syntax`, in CI): fails when any JavaScript file of the build uses syntax newer than ES2022 (Chrome 94, Firefox 93, Safari 15.4), so a dependency cannot raise the minimum browser unnoticed.
- **A big journal is tested for.** `npm run e2e:scale` (in CI) multiplies the demo data to 2,000 notes, items and people in a real Chromium and fails when a heavy screen holds the page for over 2.5 s or the memory passes 500 MB. At 3,000 of each, the longest task is half a second (the people list) and the heap stays under 100 MB.
- **Faster launch**: 16 % less JavaScript is downloaded at start (330 → 276 KB): the AI layer loads only when a record is processed or a day is closed; the router no longer drags every screen's logic along; the first screen's fonts are fetched early.
- **The build is reproducible**: two builds of the same source, in different folders, give byte-identical files; `npm run check:reproducible` (in CI) proves it and prints a fingerprint. The browser audit (`npm run e2e:audit`, in CI) now also fails when a control shows no focus ring, or when a screen needs sideways scrolling at 320 px with the page's text doubled.
- **A new version never replaces the app under your hands.** It is downloaded in the background, then a notice says "A new version is ready" with an Update button; it also applies at the next launch. The app asks for new versions every hour and when it comes back to the front. Checked in a real browser with two builds (`npm run e2e:update`, in CI): a half-written name survives, and the app reloads into the new version on request.
- **A full storage is no longer silent.** When the browser refuses to save a change for lack of room, a notice says so at once ("Storage is full. The last change was not saved. Nothing saved earlier is lost") and offers a backup, or deleting the sound of recordings older than 30 days whose text is already saved (it asks first, with the number and the size; the texts stay). It disappears by itself when writes work again, an early warning appears from 90 % of the space the browser allows, and it also covers the encrypted copy on disk when the device vault is on. Voice recording keeps its own protection (a chunk that cannot be written stays in memory and is written again). Checked in a real browser (`npm run e2e:quota`, in CI).
- **Quality baseline** (`docs/QUALITY.md`): every area measured, with the commands to repeat it. First fixes: example data and stylesheets no longer block the first screen, controls whose visible text was missing from their name now include it, `robots.txt`, actions pinned by commit hash with Dependabot. `npm run e2e:audit` (now in CI) fails on any request to another origin, any serious accessibility violation on 18 screens, or an app that does not open offline.
- **A browser test of the vault in CI** (`npm run e2e:vault`, `scripts/e2e-vault.mjs`). In a real Chromium it loads example data, reads every IndexedDB store the way anyone with the browser's files could, turns "Protect this device" on and checks that nothing readable is left (locked or unlocked) and the plain database is gone, then checks a wrong password, the right one and the recovery key, and fails on any content-policy or Trusted Types violation or console error. It runs on every pull request.
- **End-to-end encrypted cloud** (Settings → Cloud → Encrypt cloud data). Every record and recording is sealed on the device with a key that never leaves your devices (AES-256-GCM, bound to its table and id), so the server stores only data it cannot read. A recovery key is shown once; a new device gets the key from an old one through a quantum-resistant exchange (X25519 + ML-KEM-768) with 12 check digits to compare, or from the recovery key. Needs the second migration (`supabase/migrations/20261105000000_orbita_sync_push_e2e.sql`); the app notices a project without it and keeps syncing in the clear, but will not seal. Anything that reads records on the server stops working while it is on.
- **Automatic encrypted copies into a folder** (Settings → Data, Chrome, Edge and Android Chrome). Once a day a copy is written into a folder you choose, and the last 14 are kept. Each copy is sealed to a public key (X25519 + ML-KEM-768) made from a passphrase you set once; the app keeps only the public half, so it can write a copy without asking you and nothing readable or guessable is left on disk. Recordings and API keys are not in these copies. Import opens them with the same passphrase, in the usual place.
- **The server refuses an out-of-date edit.** Writes go through the new `orbita_sync_push` function, which takes the version each edit was built on. If another device wrote in between, the record is refused and named; the device reads again, merges the two edits and sends the merged record in the same round. Server rules are tested against a real PostgreSQL in CI (`scripts/test-sql.sh`).
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
