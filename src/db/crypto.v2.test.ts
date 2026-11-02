import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ARGON2_DEFAULT, CryptoError, checkPassword, createPasswordVerifier, forgetDerivedKeys, openBytes, openText, sealBytes, sealText } from './crypto';
import { base64ToBytes } from './encoding';
import { argon2ParamsSchema, sealedDataSchema } from '../domain/schemas';
import type { SealedDataV2 } from '../domain/types';

// Real Argon2id, but small enough for a test: 64 KiB, one pass.
const argon2 = { m: 64, t: 1, p: 1 };

const runs = vi.hoisted(() => ({ count: 0 }));
vi.mock('@noble/hashes/argon2.js', async (original) => {
  const real = await original<typeof import('@noble/hashes/argon2.js')>();
  return {
    ...real,
    argon2idAsync: (...args: Parameters<typeof real.argon2idAsync>) => {
      runs.count += 1;
      return real.argon2idAsync(...args);
    },
  };
});

beforeEach(() => {
  runs.count = 0;
  forgetDerivedKeys();
});

describe('version 2: Argon2id, HKDF, AES-256-GCM', () => {
  it('round-trips text, including Cyrillic and emoji', async () => {
    const text = 'Привет, «Орбита»! 🚀 ключ: sk-ant-123';
    const sealed = await sealText('пароль', text, { argon2, aad: 'x' });
    expect(await openText('пароль', sealed, { aad: 'x' })).toBe(text);
  });

  it('describes the format and keeps the cost next to the data', async () => {
    const a = (await sealText('secret-password', 'x', { argon2 })) as SealedDataV2;
    const b = (await sealText('secret-password', 'x', { argon2 })) as SealedDataV2;
    expect(a).toMatchObject({ v: 2, alg: 'AES-GCM', kdf: 'Argon2id', m: 64, t: 1, p: 1 });
    expect(sealedDataSchema.safeParse(a).success).toBe(true);
    expect(base64ToBytes(a.salt)).toHaveLength(16);
    expect(base64ToBytes(a.iv)).toHaveLength(12);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(JSON.stringify(a)).not.toContain('secret-password');
  });

  it('is the default, and the default cost is above the OWASP minimum (19 MiB, 2 passes)', async () => {
    expect(ARGON2_DEFAULT.m).toBeGreaterThanOrEqual(19_456);
    expect(ARGON2_DEFAULT.t).toBeGreaterThanOrEqual(2);
    expect(argon2ParamsSchema.safeParse(ARGON2_DEFAULT).success).toBe(true);
    const sealed = await sealText('p', 'x'); // no options at all
    expect(sealed).toMatchObject({ v: 2, kdf: 'Argon2id', ...ARGON2_DEFAULT });
  }, 30_000);

  it('rejects a wrong password, and bytes that were changed', async () => {
    const sealed = await sealText('верный', 'тайна', { argon2 });
    await expect(openText('неверный', sealed)).rejects.toMatchObject({ code: 'wrong_password' });
    const bytes = base64ToBytes(sealed.data);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    await expect(openText('верный', { ...sealed, data: btoa(String.fromCharCode(...bytes)) })).rejects.toMatchObject({ code: 'wrong_password' });
  });

  it('refuses a blob in another context: the purpose is authenticated', async () => {
    const sealed = await sealText('p', 'keys', { argon2, aad: 'orbita/api-keys/v1' });
    expect(await openText('p', sealed, { aad: 'orbita/api-keys/v1' })).toBe('keys');
    await expect(openText('p', sealed, { aad: 'orbita/backup/v1' })).rejects.toMatchObject({ code: 'wrong_password' });
    await expect(openText('p', sealed)).rejects.toMatchObject({ code: 'wrong_password' });
  });

  it('does not open if the stored cost was changed (the key depends on it)', async () => {
    const sealed = (await sealText('p', 'x', { argon2: { m: 64, t: 2, p: 1 } })) as SealedDataV2;
    await expect(openText('p', { ...sealed, t: 1 })).rejects.toMatchObject({ code: 'wrong_password' });
  });

  it('refuses a cost that would exhaust memory, or that is nonsense', async () => {
    const sealed = (await sealText('p', 'x', { argon2 })) as SealedDataV2;
    await expect(openText('p', { ...sealed, m: 4_000_000 })).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(openText('p', { ...sealed, m: 4, p: 1 })).rejects.toBeInstanceOf(CryptoError);
    expect(sealedDataSchema.safeParse({ ...sealed, m: 4_000_000 }).success).toBe(false);
    expect(sealedDataSchema.safeParse({ ...sealed, t: 0 }).success).toBe(false);
  });

  it('treats the same password typed in composed and decomposed Unicode as one', async () => {
    const composed = 'café-ключ';
    const decomposed = 'café-ключ';
    const sealed = await sealText(composed, 'x', { argon2 });
    expect(await openText(decomposed, sealed)).toBe('x');
  });

  it('opens version 1 data, which older versions wrote', async () => {
    const old = await sealText('p', 'старое', { iterations: 210_000 });
    expect(old.v).toBe(1);
    expect(await openText('p', old)).toBe('старое');
    expect(runs.count).toBe(0); // no Argon2id involved
  });

  it('round-trips raw bytes', async () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    expect([...(await openBytes('p', await sealBytes('p', bytes, { argon2 })))]).toEqual([...bytes]);
  });
});

describe('password check and one derivation per unlock', () => {
  it('accepts the password and nothing else', async () => {
    const stored = await createPasswordVerifier('1234пароль', { argon2 });
    expect(stored).toMatchObject({ iterations: 0, argon2 });
    expect(await checkPassword('1234пароль', stored)).toBe(true);
    expect(await checkPassword('1234пароль ', stored)).toBe(false);
    expect(await checkPassword('', stored)).toBe(false);
  });

  it('checking the password and opening what shares its salt is one Argon2id run, not two', async () => {
    const stored = await createPasswordVerifier('пароль', { argon2 });
    const sealed = await sealText('пароль', 'ключи', { argon2, salt: stored.salt, aad: 'k' });
    runs.count = 0;
    forgetDerivedKeys();
    expect(await checkPassword('пароль', stored)).toBe(true);
    expect(await openText('пароль', sealed, { aad: 'k' })).toBe('ключи');
    expect(runs.count).toBe(1);
  });

  it('a different password or salt is a new run, and forgetting the keys drops the memo', async () => {
    const stored = await createPasswordVerifier('a', { argon2 });
    runs.count = 0;
    forgetDerivedKeys();
    await checkPassword('a', stored);
    await checkPassword('b', stored);
    expect(runs.count).toBe(2);
    forgetDerivedKeys();
    await checkPassword('b', stored);
    expect(runs.count).toBe(3);
  });
});
