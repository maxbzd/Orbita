/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `1` switches the AI and speech providers to the deterministic mock (tests, demos without keys). */
  readonly VITE_MOCK_AI?: string;
  /** Cloud sync: another Supabase project (see src/sync/config.ts and .env.example). */
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_KEY?: string;
  /** `off` forces cloud sync off even when the Supabase variables are set. */
  readonly VITE_CLOUD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
