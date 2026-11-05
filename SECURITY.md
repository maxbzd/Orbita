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
- weaknesses in the password lock, the encrypted backup, or the device vault (`src/features/lock`, `src/db/backup*`, `src/vault`, `src/crypto`);
- cross-site scripting or content-policy bypasses in the web app, including through model answers, imported chats or shared text.

## What protects what

The full picture, with who each protection is for and where it ends, is in [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md).

- **Protect this device** (Settings → vault): nothing readable is written to the device. The database lives in memory; rows are sealed with AES-256-GCM (each bound to its table and id, recordings included) into an encrypted journal. The data key is wrapped by a password (Argon2id, 32 MiB, 3 passes), a recovery key, and optionally passkeys (WebAuthn PRF). Locking reloads the page so plain values leave memory. This protects a lost or stolen device, or someone reading the browser's files. It does not protect against malware running as you, or against an attacker who can change the page's code while you are unlocked.
- **Encrypted backups** use the same Argon2id and AES-256-GCM, with the purpose authenticated. **Automatic copies** into a folder are sealed to a public key made from a passphrase (X25519 + ML-KEM-768, passphrase stretched with Argon2id): the app holds no secret to write one, and they carry no recordings or API keys.
- **Cloud encryption** (optional, Settings → Cloud): records and recordings are sealed on the device with a key that stays on your devices (AES-256-GCM); a new device receives it through an X25519 + ML-KEM-768 exchange with check digits, or from the recovery key. The server still sees the table, id, size and time of each record.
- **Trusted Types** (in the content policy) make the browser refuse any string that would become code; the only exception is a default policy that allows script addresses on the app's own origin.
- **Sync** (optional, Supabase) sends records to your own project, protected by row-level security; without the cloud encryption above, the owner of the project can read them.
- No independent audit has been done. Treat these as defence in depth, not a guarantee.

## For people who host Orbita

- Keep the Content-Security-Policy in `index.html` strict. A custom OpenAI-compatible server must be added to its `connect-src` list on purpose.
- Never put a service-role key or an AI key in the build variables (`VITE_*` values are public). The only Supabase values the app needs are the project URL and the publishable (anon) key.
- If the project is only for you, switch off public sign-ups in Supabase.
