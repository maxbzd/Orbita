# Security policy

## Supported versions

Security fixes go into the latest release on the `main` branch.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately with GitHub's [private vulnerability reporting](https://github.com/maxbzd/Orbita/security/advisories/new)
(the "Report a vulnerability" button on the Security tab). Include what you found, how to reproduce it, and the impact.
You will get an acknowledgement within a few days, and we will keep you informed as it is fixed. Please give us a reasonable
time to release a fix before disclosing details publicly.

## What counts

Orbita keeps data on the user's device and has one optional server component: the sync schema in `supabase/migrations/`.
Especially interesting:

- ways to read or write another user's rows (row-level security, the guard and tombstone triggers, the `audio` bucket policies);
- leaks of API keys or the lock password into backups, sync, logs or the browser;
- weaknesses in the password lock or the encrypted backup (`src/features/lock`, `src/db/backup*`);
- cross-site scripting or content-policy bypasses in the web app, including through model answers, imported chats or shared text.

## For people who host Orbita

- Keep the Content-Security-Policy in `index.html` strict. A custom OpenAI-compatible server must be added to its `connect-src` list on purpose.
- Never put a service-role key or an AI key in the build variables (`VITE_*` values are public). The only Supabase values the app needs are the project URL and the publishable (anon) key.
- If the project is only for you, switch off public sign-ups in Supabase.
