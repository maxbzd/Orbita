# Security model

[Русский](ru/SECURITY_MODEL.md)

What Orbita protects, against whom, how, and where the protection ends. For reporting a vulnerability see [SECURITY.md](../SECURITY.md).

## What is at stake

A voice journal is about as personal as data gets: what you said out loud, your plans and promises, how you slept and felt,
the people around you, and the recordings themselves. It lives in IndexedDB on your device, optionally in your own Supabase
project, and, if you set up an AI provider, in that provider's hands for the length of a request.

## Who it is protected against

| Threat | What protects you | Where it ends |
|---|---|---|
| Someone with your **unlocked phone or browser profile**, or a copy of its disk | **Protect this device**: nothing readable is written to disk, recordings included; the data key is opened by your password, a passkey or the recovery key | A running, unlocked app holds plain data in memory. Malware in your browser session sees what you see |
| A stolen **backup file** (in a cloud drive, an e-mail) | Encrypted backup: Argon2id → AES-256-GCM. Automatic daily copies are sealed to an X25519 + ML-KEM-768 public key | A weak password is the weak point; a backup in plain form is readable by anyone |
| **Code injected into the page** (XSS, a compromised dependency, a hostile model answer) | A strict content policy (no inline script, no `eval`, known hosts only), Trusted Types (no string becomes code), model replies parsed and validated and never rendered as HTML | A dependency already in the bundle runs with the app's rights. CI audits dependencies and checks registry signatures. Styles may be inline (`style-src 'unsafe-inline'`), which can change how the page looks but cannot run code |
| A **compromised or curious server** (your Supabase project) | **Encrypt cloud data**: every record and recording is sealed on the device before it is sent | The server sees table, id, time and size of each record, and who is signed in |
| **Another user of the same Supabase project** | Row-level security on every table and the audio bucket; the sync function is `SECURITY INVOKER`, so it runs with the caller's rights; tested against a real PostgreSQL in CI | A project owner can always read what is not sealed. Switch off public sign-ups if the project is only yours |
| **Two devices overwriting each other** | Edits merge field by field; the server refuses a write made on a version it no longer holds and the device merges and resends | Same-field clashes keep the later edit |
| **Harvest now, decrypt later** (recorded ciphertext read by a future quantum computer) | AES-256 and Argon2id are not weakened in practice by quantum attacks. Key transfer between devices and automatic backups use hybrid X25519 + ML-KEM-768 | Only protocols with public keys needed this |
| **Guessing a password** offline | Argon2id (32 MiB, 3 passes); a passkey (WebAuthn PRF) has nothing to guess | A short password is still short. Use a phrase |
| **A leaked API key** | Keys stay on the device, are never in a backup or in sync, and with the vault on are sealed with everything else | A key you type into a provider's page is that provider's problem; Orbita sends it only to the host you chose |

## What it does not protect against

- A device that is already compromised (keylogger, a malicious extension, a rooted phone).
- Someone who watches you type the password, or who forces you to unlock.
- What you choose to send to an AI provider: a transcript, a question, or (with speech-to-text) a recording goes to the host you configured, under that provider's terms. The app shows what will be sent first; **Copy and paste** and **Built-in rules** send nothing.
- Deleting the data: the browser may keep the freed blocks on disk until they are overwritten, so a deleted plain database is not securely erased. This is why the safe order is to turn protection on, not to rely on deleting.
- Safari's 7-day rule on iPhone and iPad (data of a site not opened for a week is deleted); install the app to the Home Screen and keep a backup.
- Forgetting everything: there is no back door. Without the password, a passkey and the recovery key, the data is gone by design.

## How the pieces work

**Protect this device** (`src/vault/`). A random 256-bit **data key** encrypts every database row with AES-256-GCM; each sealed row is bound to its table and key, and recordings are sealed the same way, so a moved or swapped row is refused. The data key is stored only wrapped: by your password (Argon2id, HKDF), by a **recovery key** shown once, and optionally by **passkeys**, whose secret is computed inside the authenticator (WebAuthn PRF) and never stored. The database itself lives in memory while the app is open; sealed records go to an encrypted journal within about 30 ms of a change and when the app is left. Locking (by hand, after inactivity, after leaving the app) reloads the page, which drops every plain value. One window at a time. What stays visible on disk: that the vault exists, table names, how many rows, their sizes.

**Backups** (`src/db/backup.ts`, `src/db/autoBackup.ts`). A file sealed with a password, or automatic daily copies into a folder you choose (the last 14 are kept), sealed to a public key so that no secret is needed to write one. The matching private key exists only as a passphrase you choose (Argon2id → seed → X25519 + ML-KEM-768 key pair). Automatic copies carry no recordings and no API keys.

**Encrypted cloud** (`src/sync/e2e*.ts`). A random cloud key stays on your devices; each record is sealed with it, bound to its table and id (`{_e2e:1,k,iv,c}`); recordings use their own sealed format bound to the recording's id. Merging happens on the devices after opening. A device without the key reads nothing and sends nothing. A new device receives the key through `src/crypto/pairing.ts`: it shows a hybrid public key as a code with 12 check digits; the old device, after you compare the digits, seals the key to it; the answer opens only on the asker's device. The key can also be re-entered from a recovery key. The server migration `orbita_sync_push_e2e` lets the server accept a re-sealed copy of an unchanged record without treating it as a conflict.

**The server's rules** (`supabase/migrations/`). Every table has row-level security by owner; writes go through `orbita_sync_push`, which checks the version each edit was built on. The rules are tested against a real PostgreSQL 16 on every pull request (`scripts/test-sql.sh`).

## Cryptographic choices

| Purpose | Primitive | Why |
|---|---|---|
| Password to key | Argon2id, 32 MiB, 3 passes, 1 lane (`@noble/hashes`, pure JavaScript) | Memory-hard, so offline guessing is expensive; pure JS needs no `wasm-unsafe-eval` |
| Key separation | HKDF-SHA256 with a label per purpose | The key that encrypts is never the key that checks a password |
| Data | AES-256-GCM, 96-bit random IV, purpose and place as additional data | Authenticated, built into the browser |
| Public-key sealing | X25519 + ML-KEM-768, both secrets through one HKDF over every public value | An attacker must break both; ML-KEM is the NIST standard (FIPS 203) |
| Randomness | `crypto.getRandomValues` | |
| Passkeys | WebAuthn PRF extension | The secret never leaves the authenticator |

The libraries are `@noble/hashes`, `@noble/curves` and `@noble/post-quantum`: small, dependency-free and widely reviewed. They are
not audited as products in the way a hardware module is; if your threat model needs that, this is the place to look.

## How this was checked

- Unit tests for every primitive and protocol: tampered bytes, a moved record, a wrong purpose, a swapped header, a swapped pairing code, wrong keys, a record sealed for another table.
- `npm run e2e:vault` (in CI), in a real Chromium: with protection off the notes and names are readable in IndexedDB; after turning it on, none is, and the plain database is gone; a wrong password, the right one and the recovery key are tried; any content-policy or Trusted Types violation fails the run.
- `npm run e2e:audit` (in CI): no request leaves for any other origin on any screen, so a leak to a tracker or a CDN would fail the build.
- Server rules against a real PostgreSQL in CI; the build is reproducible (`npm run check:reproducible`) so the published files can be compared with a build of the source.

## Known limits, stated plainly

- The vault keeps the database in memory, so very large databases (and many recordings) cost memory, and a crash in the first 30 ms after a change can lose that change.
- Two windows cannot share one open vault.
- Not independently audited. Review is welcome (see SECURITY.md).
- Orbita has no server of its own: with the cloud on, what you trust is your Supabase project, its access rules and, with encryption on, nothing but your devices.
