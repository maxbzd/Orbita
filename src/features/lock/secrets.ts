import { CryptoError, openText, sealText } from '../../db';
import type { SessionSecrets } from '../../db';
import type { SealedData, Settings } from '../../domain/types';
import { t } from '../../i18n';

/**
 * Format of `Settings.lock.sealedSecrets`.
 *
 * While the app lock is on, the API keys are not stored in the clear. The three key fields of the stored
 * settings are empty, and their values live in one AES-256-GCM blob (`SealedData`, key from the password with
 * PBKDF2-SHA256, see db/crypto.ts). The plaintext inside the blob is this JSON document:
 *
 *   { "v": 1, "anthropic": "<key>", "openaiCompat": "<key>", "stt": "<key>" }
 *
 * - `v` is the format version (anything else is rejected, so a later format can be told apart);
 * - a key that was never set is the empty string;
 * - the blob is opened only after the password is checked, and the result goes to memory (`setSessionSecrets`),
 *   never back to the database.
 */
export const SEALED_SECRETS_VERSION = 1;

export const EMPTY_SECRETS: SessionSecrets = { anthropic: '', openaiCompat: '', stt: '' };

/** The three keys of a settings object. */
export function collectSecrets(settings: Settings): SessionSecrets {
  return {
    anthropic: settings.ai.anthropic.apiKey,
    openaiCompat: settings.ai.openaiCompat.apiKey,
    stt: settings.stt.apiKey,
  };
}

export async function sealSecrets(password: string, secrets: SessionSecrets, options?: { iterations?: number }): Promise<SealedData> {
  const document = { v: SEALED_SECRETS_VERSION, anthropic: secrets.anthropic, openaiCompat: secrets.openaiCompat, stt: secrets.stt };
  return sealText(password, JSON.stringify(document), options);
}

/** @throws CryptoError `wrong_password` for a wrong password, `invalid_payload` when the document is not ours. */
export async function openSecrets(password: string, sealed: SealedData): Promise<SessionSecrets> {
  const text = await openText(password, sealed);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CryptoError('invalid_payload', t('The encrypted keys are corrupted.'));
  }
  if (typeof value !== 'object' || value === null || (value as { v?: unknown }).v !== SEALED_SECRETS_VERSION) {
    throw new CryptoError('invalid_payload', t('The encrypted keys are in an unknown format.'));
  }
  const field = (name: string): string => {
    const entry = (value as Record<string, unknown>)[name];
    return typeof entry === 'string' ? entry : '';
  };
  return { anthropic: field('anthropic'), openaiCompat: field('openaiCompat'), stt: field('stt') };
}
