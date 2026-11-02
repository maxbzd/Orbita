import { PBKDF2_MAX_ITERATIONS, PBKDF2_MIN_ITERATIONS, argon2ParamsSchema } from '../domain/schemas';
import type { Argon2Params, SealedData, SealedDataV1, SealedDataV2 } from '../domain/types';
import { base64ToBytes, bytesToBase64 } from './encoding';
import { t } from '../i18n';

/**
 * Password-based encryption on WebCrypto, used for encrypted backups and for sealing API keys while the lock is on.
 *
 * Version 2 (what new data uses): the password goes through Argon2id (memory-hard: a stolen file or lock record cannot be
 * guessed against on GPUs or ASICs the way a PBKDF2 hash can) into one 256-bit master key. HKDF-SHA256 then splits it
 * into independent keys, one that encrypts (AES-256-GCM) and one that checks the password, so the check value
 * reveals nothing about the encryption key, and a single Argon2id run serves both an unlock and a decryption.
 * The context (`aad`: "backup", "api keys") is authenticated, so a blob made for one purpose is refused for another.
 *
 * Version 1 (older files): PBKDF2-HMAC-SHA256 → AES-256-GCM. It is still read, and the lock upgrades itself the next
 * time it is unlocked. The password is never stored: only a verifier derived from the master key.
 */

/** Argon2id for new data: 32 MiB, 3 passes, 1 lane. Above the OWASP minimum (19 MiB, 2 passes); about 0.6 s on a laptop. */
export const ARGON2_DEFAULT: Argon2Params = { m: 32_768, t: 3, p: 1 };

/** PBKDF2 work factor for version 1 (kept for tests and for reading old data). */
export const PBKDF2_ITERATIONS = 600_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const V1_VERIFIER_LABEL = 'orbit-password-verifier';
const HKDF_ENC = 'orbita/v2/aes-256-gcm';
const HKDF_VERIFY = 'orbita/v2/password-check';

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

/** Which key derivation to use: Argon2id by default; `iterations` asks for the old PBKDF2 (older files, quick tests). */
export interface SealOptions {
  iterations?: number;
  argon2?: Argon2Params;
  /** What the data is for. Authenticated with it, so it must be the same when opening. */
  aad?: string;
  /**
   * Version 2 only: reuse this base64 salt instead of a fresh one. The lock does it so that the password check and the
   * sealed API keys come from the same Argon2id run (one derivation per unlock). Every seal still gets its own IV.
   */
  salt?: string;
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

const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

function assertIterations(iterations: number): void {
  if (!Number.isInteger(iterations) || iterations < PBKDF2_MIN_ITERATIONS || iterations > PBKDF2_MAX_ITERATIONS) {
    throw new CryptoError(
      'invalid_payload',
      t('Invalid number of iterations: {iterations} (it must be from {PBKDF2_MIN_ITERATIONS} to {PBKDF2_MAX_ITERATIONS}).', { iterations, PBKDF2_MIN_ITERATIONS, PBKDF2_MAX_ITERATIONS }),
    );
  }
}

function assertArgon2(params: Argon2Params): void {
  if (!argon2ParamsSchema.safeParse(params).success) {
    throw new CryptoError('invalid_payload', t('The encrypted data is damaged.'));
  }
}

// ───────── PBKDF2 (version 1) ─────────

async function passwordKeyMaterial(password: string): Promise<CryptoKey> {
  return subtle().importKey('raw', utf8(password), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
}

async function deriveAesKeyV1(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    await passwordKeyMaterial(password),
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function verifierBitsV1(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const labelled = new Uint8Array([...salt, ...utf8(V1_VERIFIER_LABEL)]);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: labelled, iterations }, await passwordKeyMaterial(password), 256);
  return new Uint8Array(bits);
}

// ───────── Argon2id + HKDF (version 2) ─────────

/**
 * The master key of the last password used, for a few seconds: an unlock checks the password and then opens the
 * sealed keys, which are two uses of one derivation, and Argon2id is meant to be slow. The same secret is already
 * held in memory (`lockService`) for as long as the app is unlocked, so this adds no new exposure.
 */
const MASTER_TTL_MS = 15_000;
let recent: { id: string; master: Uint8Array<ArrayBuffer>; at: number } | null = null;

export function forgetDerivedKeys(): void {
  recent?.master.fill(0);
  recent = null;
}

async function masterKey(password: string, salt: Uint8Array<ArrayBuffer>, params: Argon2Params): Promise<Uint8Array<ArrayBuffer>> {
  assertArgon2(params);
  // NFKC: the same password typed on another keyboard or system composes to the same bytes.
  const secret = utf8(password.normalize('NFKC'));
  const digest = await subtle().digest('SHA-256', new Uint8Array([...secret, 0, ...salt, 0, ...utf8(`${params.m}/${params.t}/${params.p}`)]));
  const id = bytesToBase64(new Uint8Array(digest));
  if (recent && recent.id === id && Date.now() - recent.at < MASTER_TTL_MS) return recent.master;
  forgetDerivedKeys();
  // The async variant yields to the event loop between blocks, so the page stays responsive for the second or two it takes.
  // Loaded on first use: most launches (no lock, no backup) never need it, so it stays out of the startup bundle.
  const { argon2idAsync } = await import('@noble/hashes/argon2.js');
  const master = new Uint8Array(await argon2idAsync(secret, salt, { m: params.m, t: params.t, p: params.p, dkLen: 32, asyncTick: 10 })) as Uint8Array<ArrayBuffer>;
  secret.fill(0);
  recent = { id, master, at: Date.now() };
  return master;
}

async function hkdf(master: Uint8Array<ArrayBuffer>, info: string, usage: 'key' | 'bits'): Promise<CryptoKey | Uint8Array> {
  const base = await subtle().importKey('raw', master, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const params = { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: utf8(info) } as const;
  if (usage === 'bits') return new Uint8Array(await subtle().deriveBits(params, base, 256));
  return subtle().deriveKey(params, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

const aesKeyV2 = async (password: string, salt: Uint8Array<ArrayBuffer>, params: Argon2Params): Promise<CryptoKey> =>
  (await hkdf(await masterKey(password, salt, params), HKDF_ENC, 'key')) as CryptoKey;

const verifierBitsV2 = async (password: string, salt: Uint8Array<ArrayBuffer>, params: Argon2Params): Promise<Uint8Array> =>
  (await hkdf(await masterKey(password, salt, params), HKDF_VERIFY, 'bits')) as Uint8Array;

// ───────── Seal and open ─────────

export async function sealBytes(password: string, plaintext: Uint8Array<ArrayBuffer>, options: SealOptions = {}): Promise<SealedData> {
  const iv = randomBytes(IV_BYTES);
  const salt = options.salt !== undefined && options.iterations === undefined ? base64ToBytes(options.salt) : randomBytes(SALT_BYTES);
  if (options.iterations !== undefined) {
    assertIterations(options.iterations);
    const key = await deriveAesKeyV1(password, salt, options.iterations);
    const encrypted = await subtle().encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    return {
      v: 1,
      alg: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: options.iterations,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(encrypted)),
    };
  }
  const params = options.argon2 ?? ARGON2_DEFAULT;
  const key = await aesKeyV2(password, salt, params);
  const encrypted = await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8(options.aad ?? '') }, key, plaintext);
  return {
    v: 2,
    alg: 'AES-GCM',
    kdf: 'Argon2id',
    m: params.m,
    t: params.t,
    p: params.p,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(encrypted)),
  };
}

/** @throws CryptoError `wrong_password` when the password or the context is wrong or the data was tampered with. */
export async function openBytes(password: string, sealed: SealedData, { aad }: { aad?: string } = {}): Promise<Uint8Array<ArrayBuffer>> {
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
  let key: CryptoKey;
  let algorithm: AesGcmParams;
  if (sealed.v === 1) {
    assertIterations((sealed as SealedDataV1).iterations);
    key = await deriveAesKeyV1(password, salt, (sealed as SealedDataV1).iterations);
    algorithm = { name: 'AES-GCM', iv };
  } else {
    const v2 = sealed as SealedDataV2;
    key = await aesKeyV2(password, salt, { m: v2.m, t: v2.t, p: v2.p });
    algorithm = { name: 'AES-GCM', iv, additionalData: utf8(aad ?? '') };
  }
  try {
    return new Uint8Array(await subtle().decrypt(algorithm, key, data));
  } catch {
    // GCM cannot tell a wrong key from modified bytes (or a wrong context); all are reported as one error on purpose.
    throw new CryptoError('wrong_password', t('Wrong password or the data is damaged.'));
  }
}

export async function sealText(password: string, text: string, options?: SealOptions): Promise<SealedData> {
  return sealBytes(password, utf8(text), options);
}

export async function openText(password: string, sealed: SealedData, options?: { aad?: string }): Promise<string> {
  return new TextDecoder().decode(await openBytes(password, sealed, options));
}

// ───────── Password verifier (for the lock screen) ─────────

export interface PasswordVerifier {
  /** Base64. */
  salt: string;
  /** PBKDF2 iterations; 0 when `argon2` is set. */
  iterations: number;
  /** Set when the check value comes from Argon2id. */
  argon2?: Argon2Params;
  /** Base64 of a value that is independent of the encryption key. */
  verifier: string;
}

export async function createPasswordVerifier(password: string, options: Pick<SealOptions, 'iterations' | 'argon2'> = {}): Promise<PasswordVerifier> {
  const salt = randomBytes(SALT_BYTES);
  if (options.iterations !== undefined) {
    assertIterations(options.iterations);
    return { salt: bytesToBase64(salt), iterations: options.iterations, verifier: bytesToBase64(await verifierBitsV1(password, salt, options.iterations)) };
  }
  const argon2 = options.argon2 ?? ARGON2_DEFAULT;
  return { salt: bytesToBase64(salt), iterations: 0, argon2, verifier: bytesToBase64(await verifierBitsV2(password, salt, argon2)) };
}

export async function checkPassword(password: string, stored: PasswordVerifier): Promise<boolean> {
  const expected = base64ToBytes(stored.verifier);
  let actual: Uint8Array;
  if (stored.argon2) actual = await verifierBitsV2(password, base64ToBytes(stored.salt), stored.argon2);
  else {
    assertIterations(stored.iterations);
    actual = await verifierBitsV1(password, base64ToBytes(stored.salt), stored.iterations);
  }
  if (expected.length !== actual.length) return false;
  let difference = 0;
  for (let i = 0; i < actual.length; i++) difference |= actual[i]! ^ expected[i]!;
  return difference === 0;
}
