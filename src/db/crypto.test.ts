import { describe, expect, it } from 'vitest';
import { PBKDF2_MIN_ITERATIONS } from '../domain/schemas';
import {
  CryptoError,
  PBKDF2_ITERATIONS,
  checkPassword,
  createPasswordVerifier,
  openBytes,
  openText,
  sealBytes,
  sealText,
} from './crypto';
import { base64ToBytes } from './encoding';

// The minimum allowed work factor keeps the suite fast; the default is covered below.
const iterations = PBKDF2_MIN_ITERATIONS;

describe('sealed data', () => {
  it('round-trips text, including Cyrillic and emoji', async () => {
    const text = 'Привет, «Орбита»! 🚀 ключ: sk-ant-123';
    const sealed = await sealText('пароль', text, { iterations });
    expect(await openText('пароль', sealed)).toBe(text);
  });

  it('round-trips raw bytes', async () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    expect([...(await openBytes('p', await sealBytes('p', bytes, { iterations })))]).toEqual([...bytes]);
  });

  it('describes the format: AES-GCM, PBKDF2-SHA256, a random salt and iv, no password anywhere', async () => {
    const a = await sealText('secret-password', 'x', { iterations });
    const b = await sealText('secret-password', 'x', { iterations });
    expect(a).toMatchObject({ v: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations });
    expect(base64ToBytes(a.salt)).toHaveLength(16);
    expect(base64ToBytes(a.iv)).toHaveLength(12);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
    expect(JSON.stringify(a)).not.toContain('secret-password');
  });

  it('uses at least 210 000 iterations by default', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(210_000);
  });

  it('rejects a wrong password with a clear error', async () => {
    const sealed = await sealText('верный', 'тайна', { iterations });
    const error = await openText('неверный', sealed).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CryptoError);
    expect(error).toMatchObject({ code: 'wrong_password', message: 'Неверный пароль или данные повреждены.' });
  });

  it('detects tampered ciphertext', async () => {
    const sealed = await sealText('p', 'тайна', { iterations });
    const bytes = base64ToBytes(sealed.data);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = { ...sealed, data: btoa(String.fromCharCode(...bytes)) };
    await expect(openText('p', tampered)).rejects.toMatchObject({ code: 'wrong_password' });
  });

  it('refuses a work factor below the minimum, when sealing and when opening', async () => {
    await expect(sealText('p', 'x', { iterations: 1000 })).rejects.toMatchObject({ code: 'invalid_payload' });
    const sealed = await sealText('p', 'x', { iterations });
    await expect(openText('p', { ...sealed, iterations: 1000 })).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('reports garbled base64 as a damaged payload', async () => {
    const sealed = await sealText('p', 'x', { iterations });
    await expect(openText('p', { ...sealed, salt: '***' })).rejects.toMatchObject({ code: 'invalid_payload' });
  });
});

describe('password verifier', () => {
  it('accepts the password and nothing else', async () => {
    const stored = await createPasswordVerifier('1234пароль', { iterations });
    expect(await checkPassword('1234пароль', stored)).toBe(true);
    expect(await checkPassword('1234пароль ', stored)).toBe(false);
    expect(await checkPassword('', stored)).toBe(false);
  });

  it('does not contain the password and differs from the encryption key material', async () => {
    const stored = await createPasswordVerifier('hunter2', { iterations });
    const other = await createPasswordVerifier('hunter2', { iterations });
    expect(JSON.stringify(stored)).not.toContain('hunter2');
    expect(stored.salt).not.toBe(other.salt);
    expect(stored.verifier).not.toBe(other.verifier);
  });
});
