# Changelog

All notable changes to Orbita are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
