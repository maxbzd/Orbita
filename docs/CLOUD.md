# Cloud: sync between your devices

Orbita stays local-first: IndexedDB on the device is the primary store and everything works with no network. The cloud (Supabase) is a
copy through which your devices exchange changes. It is **off by default** and uses **your own Supabase project**; nothing is sent to
anyone else. Sign in with email and password in Settings → Cloud.

## Set it up (once)

1. Create a project at [supabase.com](https://supabase.com) (the free plan is enough).
2. Apply the schema in `supabase/migrations/` (SQL editor, or `supabase db push` with the CLI), **all files in order**. They create
   `public.sync_rows`, its RLS policies and triggers, the private `audio` bucket with per-user policies, and the function
   `orbita_sync_push` that refuses an out-of-date edit. A project that only has the first file still works for plain, unencrypted sync; the
   app notices and falls back, and it will not turn encryption on until the second file is applied.
3. Authentication → Providers → Email: for a personal app it is convenient to turn "Confirm email" off (otherwise you must open the
   message after signing up). If you leave it on, the link goes to the Site URL: set it in Authentication → URL Configuration to the
   address where your copy of Orbita is published, and add that address to Redirect URLs (needed for password reset).
4. Copy the project URL and the **publishable (anon) key** into `.env` (see `.env.example`) before building:

   ```bash
   VITE_SUPABASE_URL=https://<your-project>.supabase.co
   VITE_SUPABASE_KEY=<publishable anon key>
   ```

   Both are public values by design: access is controlled by row-level security and your account. **Never put a `service_role` key
   in the app.** Without these two variables the Cloud section is hidden; `VITE_CLOUD=off` hides it even when they are set.
5. Rebuild and open the app → Settings → Cloud → create an account on the first device, sign in on the others.

## What is synced

Captures, objects, people, projects, check-ins, patterns, reviews, the profile, context presets, links, the AI usage counter and
tombstones (permanent deletions). Audio goes as separate files in the private `audio` bucket.

Not synced: settings (AI keys, the lock, the theme), demo data, in-progress records (an empty shell of a capture, "transcribing",
"extracting"), and chunks of an unfinished recording.

## How it works

- **Server:** the table `public.sync_rows (user_id, tbl, id, data jsonb, ver, target_tbl, updated_at)` with "own rows only" RLS; migrations in
  `supabase/migrations/`. Triggers: the server clock in `updated_at` (the read cursor), an old version never overwrites a newer one
  (`ver`, the record's own `updatedAt` / `deletedAt`, sent next to it so it is still readable when the record is sealed), a tombstone removes
  the row it names from the cloud. Writes go through `orbita_sync_push(rows)`, which also takes the version each edit was built on (`base`):
  if the cloud has moved on since, the record is refused and named, the device reads again (that merges the two edits field by field) and sends
  the merged record, so two devices writing at the same moment cannot overwrite each other. Bucket `audio`: `audio/<user id>/<capture id>`, policies by user folder.
- **Client:** `src/sync/`: `engine.ts` (merge and push; knows nothing about Supabase), `supabaseBackend.ts` (the adapter), `service.ts` (sign-in,
  schedule, realtime, state), `rows.ts` (which tables and how they are versioned). A service table `syncmeta` in IndexedDB remembers which version of each
  record the cloud already knows; changes are found by comparing versions, so writes need no interception.
- **A round:** first read the cloud (everything changed after the cursor, with a 15 s margin) and merge with the same logic as a backup
  import (the later `updatedAt` wins, tombstones beat older records); then push local changes; then audio.
- **When:** after sign-in, 2.5 s after any local change, on a realtime signal from other devices, when the tab regains focus, when the network
  returns, and once a minute. After a connection failure it retries with growing pauses. Several tabs never sync at once (Web Locks).
- A foreign account on a device is never mixed in silently: the app asks whether to clear the device or merge.
- "Delete everything" while signed in first erases the cloud copy, otherwise the next sync would bring the data back.

## Encrypting the cloud copy (end to end)

Settings → Cloud → **Encrypt cloud data**. A random 256-bit key is made on the device; every record and every recording is sealed with it
(AES-256-GCM, each bound to its table and id) before it leaves, so the server stores only data it cannot read, and neither can anyone who
gets into it. The key never leaves your devices except by your hand:

- a **recovery key** is shown once when you turn it on (write it down; it can be shown again on a device that has the key);
- a **new device** gets the key from an old one with *Add a device*: a code exchange (X25519 + ML-KEM-768, so a recording of the exchange cannot be read
  by a future quantum computer later) with 12 check digits to compare on both screens, or from the recovery key;
- signing out of a device removes the key from it.

What the server still sees: which table and id a record has, when it changed, how big it is, and that a deletion happened.
What stops working: anything that reads your records on the server (for example a connection to Claude that queries the cloud copy).
If you lose every device and the recovery key, the cloud copy cannot be read by anyone. Turning it on seals the data that is already
in the cloud over the plain copy; a recording that exists only in the cloud and was never downloaded to a device stays as it was until
that device opens the app and downloads it.

## Honest about privacy

Without encryption turned on, data in the cloud is protected by RLS and your account password, but it is **not encrypted with your own key**.
The owner of the Supabase project can technically read it; if you host the project yourself, that is you. Turn on the encryption above, or
do not sign in: the app works completely locally.

## Testing

`npx vitest run src/sync`: the engine against a fake cloud with two "devices" (merging, the out-of-date-edit race, sealed records and
recordings), and the service against a fake client. `scripts/test-sql.sh` applies every migration to a throwaway PostgreSQL and checks the
server rules in `supabase/tests/` (CI runs it against a real PostgreSQL 16; a stub stands in for the Supabase parts).
