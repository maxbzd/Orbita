import { z } from 'zod';
import { fromBase64, fromUtf8, randomBytes, toBase64, utf8 } from '@/crypto/bytes';
import { decodePublicKey, encodePublicKey, hybridKeyPairFromPassphrase, hybridOpen, hybridSeal } from '@/crypto/hybrid';
import type { HybridSealed } from '@/crypto/hybrid';
import type { AutoBackupSettings } from '../domain/types';
import { ARGON2_DEFAULT, CryptoError, validArgon2 } from '@/crypto/password';
import type { Argon2Params } from '@/crypto/password';

/**
 * A copy sealed to a public key, for the automatic backups into a folder. Making it needs no secret, so it can happen in
 * the background with the app closed to the passphrase; opening it needs the passphrase the key pair was made from
 * (X25519 + ML-KEM-768, so it holds against a future quantum computer too). Only the public half is kept on the device.
 */

export const KEY_BACKUP_AAD = 'orbita/backup/key/v1';

export type AutoBackupKey = Pick<AutoBackupSettings, 'salt' | 'm' | 't' | 'p' | 'publicKey'>;

export interface KeyEncryptedBackup {
  format: 'orbit-backup-v1';
  encrypted: true;
  exportedAt: string;
  kdf: Argon2Params & { salt: string };
  key: HybridSealed;
}

const hybridSealedSchema = z.object({
  v: z.literal(1),
  alg: z.literal('X25519+ML-KEM-768/AES-256-GCM'),
  epk: z.string(),
  ct: z.string(),
  iv: z.string(),
  data: z.string(),
}) satisfies z.ZodType<HybridSealed>;

export const keyEncryptedBackupSchema = z.object({
  format: z.literal('orbit-backup-v1'),
  encrypted: z.literal(true),
  exportedAt: z.string(),
  kdf: z.object({ m: z.number(), t: z.number(), p: z.number(), salt: z.string() }),
  key: hybridSealedSchema,
}) satisfies z.ZodType<KeyEncryptedBackup>;

export const isKeyBackup = (value: unknown): boolean => !!value && typeof value === 'object' && 'kdf' in value && 'key' in value;

/** Sets up automatic copies: the passphrase becomes a key pair; only the public half is kept. */
export async function createAutoBackupKey(passphrase: string, argon2: Argon2Params = ARGON2_DEFAULT): Promise<AutoBackupKey> {
  const salt = randomBytes(16);
  const pair = await hybridKeyPairFromPassphrase(passphrase, salt, argon2);
  return { salt: toBase64(salt), m: argon2.m, t: argon2.t, p: argon2.p, publicKey: encodePublicKey(pair.publicKey) };
}

export async function sealBackupToKey(plain: { exportedAt: string }, config: AutoBackupKey): Promise<KeyEncryptedBackup> {
  return {
    format: 'orbit-backup-v1',
    encrypted: true,
    exportedAt: plain.exportedAt,
    kdf: { m: config.m, t: config.t, p: config.p, salt: config.salt },
    key: await hybridSeal(decodePublicKey(config.publicKey), utf8(JSON.stringify(plain)), KEY_BACKUP_AAD),
  };
}

/** Opens a copy made by `sealBackupToKey` with the passphrase. @throws CryptoError */
export async function openKeyBackup(file: KeyEncryptedBackup, passphrase: string): Promise<string> {
  const { salt, ...params } = file.kdf;
  if (!validArgon2(params)) throw new CryptoError('invalid_payload', 'The encrypted data is damaged.');
  let saltBytes: Uint8Array;
  try {
    saltBytes = fromBase64(salt);
  } catch {
    throw new CryptoError('invalid_payload', 'The encrypted data is damaged.');
  }
  const pair = await hybridKeyPairFromPassphrase(passphrase, saltBytes, params);
  return fromUtf8(await hybridOpen(pair.secretKey, pair.publicKey, file.key, KEY_BACKUP_AAD));
}
