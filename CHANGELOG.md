# Changelog

All notable changes to Orbita are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-10-20

First open-source release.

### Added

- Full English and Russian localization: interface, rule-based engine (extraction, search, questions), prompts for AI models, dates and demo data. A small dependency-free translation layer, a language picker in Settings and onboarding, `npm run i18n:check`, and [a guide to adding languages](docs/I18N.md).
- A neutral, fictional demo person (a freelance designer building a small product) in both languages, with two months of records, objects, patterns and reviews.
- English documentation, contribution guide, code of conduct, security policy, issue and pull request templates, CI.

### Changed

- The cloud sync is fully optional: with no Supabase project configured the app is entirely local and hides the online features. Project settings come from `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` at build time.
- Check-in factors, the glossary suggestions and the onboarding questions are general instead of tied to one profession.

### Removed

- All personal data, project identifiers and hosting references of the original author.
