import { settingsSchema } from '../domain/schemas';
import type { Settings } from '../domain/types';
import { db } from './schema';

export const SETTINGS_ID = 'settings';

export type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
/** Any subset of the settings, at any depth. `undefined` values are ignored. */
export type SettingsPatch = DeepPartial<Omit<Settings, 'id'>>;

/** A fresh default settings object (never share one between callers: it is mutable). */
export function defaultSettings(): Settings {
  return settingsSchema.parse({});
}

/**
 * Turns anything (a stored row, an imported file, a corrupt value) into valid settings:
 * missing or invalid values become defaults, unknown keys are dropped. Never throws.
 */
export function normalizeSettings(raw: unknown): Settings {
  return settingsSchema.parse(raw);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const current = merged[key];
    merged[key] = isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return merged;
}

/**
 * Applies a partial update on top of `base`: objects merge key by key, everything else
 * (primitives, arrays, `null`) is replaced. The result is normalized, so a bad value in the patch
 * cannot corrupt the settings.
 */
export function mergeSettings(base: Settings, patch: SettingsPatch): Settings {
  return normalizeSettings(deepMerge({ ...base }, patch as Record<string, unknown>));
}

// ───────── Keys while the app lock is on ─────────

/**
 * API keys decrypted for this tab. While the lock is on the stored settings carry blank key fields and the
 * keys live sealed in `lock.sealedSecrets` (features/lock/secrets.ts). After the password is entered the lock
 * layer puts the plain keys here, and `getSettings` hands them to everybody who builds a provider, so the AI
 * layer keeps working with plain `Settings`. Nothing here is ever persisted; a locked app has `null`.
 */
export interface SessionSecrets {
  anthropic: string;
  openaiCompat: string;
  stt: string;
}

let sessionSecrets: SessionSecrets | null = null;

export function setSessionSecrets(secrets: SessionSecrets | null): void {
  sessionSecrets = secrets ? { ...secrets } : null;
}

export function getSessionSecrets(): SessionSecrets | null {
  return sessionSecrets ? { ...sessionSecrets } : null;
}

/** Copy of `settings` with every API key field emptied (what may be written to the database while locked). */
export function blankKeys(settings: Settings): Settings {
  return {
    ...settings,
    ai: {
      ...settings.ai,
      anthropic: { ...settings.ai.anthropic, apiKey: '' },
      openaiCompat: { ...settings.ai.openaiCompat, apiKey: '' },
    },
    stt: { ...settings.stt, apiKey: '' },
  };
}

/** The stored settings with the unlocked keys filled in (no-op when the lock is off or the app is locked). */
function withSessionKeys(settings: Settings): Settings {
  if (!settings.lock.enabled || !sessionSecrets) return settings;
  return {
    ...settings,
    ai: {
      ...settings.ai,
      anthropic: { ...settings.ai.anthropic, apiKey: sessionSecrets.anthropic },
      openaiCompat: { ...settings.ai.openaiCompat, apiKey: sessionSecrets.openaiCompat },
    },
    stt: { ...settings.stt, apiKey: sessionSecrets.stt },
  };
}

/** Exactly what is in the database (defaults for the rest): key fields are blank while the lock is on. */
export async function getStoredSettings(): Promise<Settings> {
  return normalizeSettings(await db.settings.get(SETTINGS_ID));
}

/** Current settings; defaults for everything never saved. With the lock on and unlocked, the keys are plain. */
export async function getSettings(): Promise<Settings> {
  return withSessionKeys(await getStoredSettings());
}

/**
 * Merges the patch into the stored settings and saves; returns the result. While the lock is on, plain keys
 * are never written to the database (use `saveApiKeys` of the lock feature to change them).
 */
export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  return db.transaction('rw', db.settings, async () => {
    const next = mergeSettings(await getStoredSettings(), patch);
    const persisted = next.lock.enabled ? blankKeys(next) : next;
    await db.settings.put(persisted);
    return withSessionKeys(persisted);
  });
}

/** Back to defaults (onboarding starts over). */
export async function resetSettings(): Promise<Settings> {
  const settings = defaultSettings();
  await db.settings.put(settings);
  return settings;
}
