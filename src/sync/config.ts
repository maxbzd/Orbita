/**
 * The Supabase project behind optional cloud sync. The URL and the publishable key are public by design: every row
 * is protected by Row Level Security (see supabase/migrations), the key alone opens nothing.
 *
 * Without `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` cloud sync is off and the app is entirely local
 * (see docs/CLOUD.md and .env.example).
 */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_KEY: string = import.meta.env.VITE_SUPABASE_KEY ?? '';

/** Whether this build is configured with a Supabase project. */
export const syncEnabled = (): boolean => SUPABASE_URL !== '' && SUPABASE_KEY !== '' && import.meta.env.VITE_CLOUD !== 'off';

/** Storage bucket with the recordings: `audio/<user id>/<capture id>`. */
export const AUDIO_BUCKET = 'audio';
