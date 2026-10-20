import { PBKDF2_MAX_ITERATIONS, PBKDF2_MIN_ITERATIONS } from '../domain/schemas';
import type { SealedData } from '../domain/types';
import { base64ToBytes, bytesToBase64 } from './encoding';
import { t } from '../i18n';

/**
 * Password-based encryption on WebCrypto: AES-256-GCM with a key from PBKDF2-HMAC-SHA256.
 * Used for encrypted backups and for sealing API keys while the lock is on.
 * The password is never stored: only a verifier derived with a separate salt label.
 */

/** Default work factor; the count used is stored next to the ciphertext, so it can grow later. */
export const PBKDF2_ITERATIONS = 600_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const VERIFIER_LABEL = 'orbit-password-verifier';

export type CryptoErrorCode = 'unavailable' | 'wrong_password' | 'invalid_payload';

export class CryptoError extends Error {
  constructor(
    readonly code: CryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}

function subtle(): SubtleCrypto {
  const api = globalThis.crypto?.subtle;
  if (!api) {
    throw new CryptoError('unavailable', t('Encryption is unavailable: open the app over HTTPS or through localhost.'));
  }
  return api;
}

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

function assertIterations(iterations: number): void {
  if (!Number.isInteger(iterations) || iterations < PBKDF2_MIN_ITERATIONS || iterations > PBKDF2_MAX_ITERATIONS) {
    throw new CryptoError(
      'invalid_payload',
      t('Invalid number of iterations: {iterations} (it must be from {PBKDF2_MIN_ITERATIONS} to {PBKDF2_MAX_ITERATIONS}).', { iterations, PBKDF2_MIN_ITERATIONS, PBKDF2_MAX_ITERATIONS }),
    );
  }
}

async function passwordKeyMaterial(password: string): Promise<CryptoKey> {
  return subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
}

async function deriveAesKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    await passwordKeyMaterial(password),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealBytes(
  password: string,
  plaintext: Uint8Array<ArrayBuffer>,
  { iterations = PBKDF2_ITERATIONS }: { iterations?: number } = {},
): Promise<SealedData> {
  assertIterations(iterations);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveAesKey(password, salt, iterations);
  const encrypted = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return {
    v: 1,
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  };
}

/** @throws CryptoError `wrong_password` when the password is wrong or the data was tampered with. */
export async function openBytes(password: string, sealed: SealedData): Promise<Uint8Array<ArrayBuffer>> {
  assertIterations(sealed.iterations);
  let salt: Uint8Array<ArrayBuffer>;
  let iv: Uint8Array<ArrayBuffer>;
  let data: Uint8Array<ArrayBuffer>;
  try {
    salt = base64ToBytes(sealed.salt);
    iv = base64ToBytes(sealed.iv);
    data = base64ToBytes(sealed.data);
  } catch {
    throw new CryptoError('invalid_payload', t('The encrypted data is damaged.'));
  }
  const key = await deriveAesKey(password, salt, sealed.iterations);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv }, key, data));
  } catch {
    // GCM cannot tell a wrong key from modified bytes; both are reported as one error on purpose.
    throw new CryptoError('wrong_password', t('Wrong password or the data is damaged.'));
  }
}

export async function sealText(password: string, text: string, options?: { iterations?: number }): Promise<SealedData> {
  return sealBytes(password, new TextEncoder().encode(text), options);
}

export async function openText(password: string, sealed: SealedData): Promise<string> {
  return new TextDecoder().decode(await openBytes(password, sealed));
}

// ───────── Password verifier (for the lock screen) ─────────

export interface PasswordVerifier {
  /** Base64. */
  salt: string;
  iterations: number;
  /** Base64 of a PBKDF2 output that is independent of the encryption key. */
  verifier: string;
}

async function verifierBits(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const labelled = new Uint8Array([...salt, ...new TextEncoder().encode(VERIFIER_LABEL)]);
  const bits = await subtle().deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: labelled, iterations },
    await passwordKeyMaterial(password),
    256,
  );
  return new Uint8Array(bits);
}

export async function createPasswordVerifier(
  password: string,
  { iterations = PBKDF2_ITERATIONS }: { iterations?: number } = {},
): Promise<PasswordVerifier> {
  assertIterations(iterations);
  const salt = randomBytes(SALT_BYTES);
  return {
    salt: bytesToBase64(salt),
    iterations,
    verifier: bytesToBase64(await verifierBits(password, salt, iterations)),
  };
}

export async function checkPassword(password: string, stored: PasswordVerifier): Promise<boolean> {
  assertIterations(stored.iterations);
  const expected = base64ToBytes(stored.verifier);
  const actual = await verifierBits(password, base64ToBytes(stored.salt), stored.iterations);
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i] ^ expected[i];
  return difference === 0;
}
