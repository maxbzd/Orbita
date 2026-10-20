# Cloud: sync between your devices

Orbita stays local-first: IndexedDB on the device is the primary store and everything works with no network. The cloud (Supabase) is a
copy through which your devices exchange changes. It is **off by default** and uses **your own Supabase project**; nothing is sent to
anyone else. Sign in with email and password in Settings → Cloud.

## Set it up (once)

1. Create a project at [supabase.com](https://supabase.com) (the free plan is enough).
2. Apply the schema in `supabase/migrations/` (SQL editor, or `supabase db push` with the CLI). It creates `public.sync_rows`, its RLS
   policies and triggers, and the private `audio` bucket with per-user policies.
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

- **Server:** the table `public.sync_rows (user_id, tbl, id, data jsonb, updated_at)` with "own rows only" RLS; migration in
  `supabase/migrations/`. Triggers: the server clock in `updated_at` (the read cursor), an old version never overwrites a newer one
  (`updatedAt` / `deletedAt`), a tombstone removes the row from the cloud. Bucket `audio`: `audio/<user id>/<capture id>`, policies by user folder.
- **Client:** `src/sync/`: `engine.ts` (merge and push; knows nothing about Supabase), `supabaseBackend.ts` (the adapter), `service.ts` (sign-in,
  schedule, realtime, state), `rows.ts` (which tables and how they are versioned). A service table `syncmeta` in IndexedDB remembers which version of each
  record the cloud already knows; changes are found by comparing versions, so writes need no interception.
- **A round:** first read the cloud (everything changed after the cursor, with a 15 s margin) and merge with the same logic as a backup
  import (the later `updatedAt` wins, tombstones beat older records); then push local changes; then audio.
- **When:** after sign-in, 2.5 s after any local change, on a realtime signal from other devices, when the tab regains focus, when the network
  returns, and once a minute. After a connection failure it retries with growing pauses. Several tabs never sync at once (Web Locks).
- A foreign account on a device is never mixed in silently: the app asks whether to clear the device or merge.
- "Delete everything" while signed in first erases the cloud copy, otherwise the next sync would bring the data back.

## Honest about privacy

Data in the cloud is protected by RLS and your account password, but it is **not encrypted with your own key** (no end-to-end
encryption). The owner of the Supabase project can technically read it; if you host the project yourself, that is you. If that is
unacceptable, do not sign in: the app works completely locally.

## Testing

`npx vitest run src/sync`: the engine against a fake cloud with two "devices", and the service against a fake client. Server rules (RLS,
triggers, bucket) are worth checking with SQL tests in a rolled-back transaction after any change to the migration.
