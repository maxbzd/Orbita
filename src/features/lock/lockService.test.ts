import { beforeEach, describe, expect, it } from 'vitest';
import { PBKDF2_MIN_ITERATIONS } from '../../domain/schemas';
import { getSettings, getStoredSettings, updateSettings, wipeAll, setSessionSecrets, getSessionSecrets, db, CryptoError } from '../../db';
import {
  LockError,
  changePassword,
  disableLock,
  enableLock,
  initLock,
  lockNow,
  saveApiKeys,
  secondsUntilRetry,
  setLockArgon2,
  setLockIterations,
  throttleSeconds,
  unlock,
  useLockStore,
  validateNewPassword,
} from './lockService';
import { SEALED_SECRETS_VERSION, openSecrets, sealSecrets } from './secrets';

const PASSWORD = 'орбита-2026';

beforeEach(async () => {
  localStorage.clear();
  setLockIterations(PBKDF2_MIN_ITERATIONS);
  await wipeAll();
  setSessionSecrets(null);
  await initLock();
});

async function withKeys(): Promise<void> {
  await updateSettings({ ai: { anthropic: { apiKey: 'sk-ant-AAAA' }, openaiCompat: { apiKey: 'sk-oa-BBBB' } }, stt: { apiKey: 'sk-stt-CCCC' } });
}

describe('sealed secrets format', () => {
  it('seals a versioned JSON document and opens it only with the right password', async () => {
    const keys = { anthropic: 'a', openaiCompat: 'b', stt: 'c' };
    const sealed = await sealSecrets(PASSWORD, keys, { iterations: PBKDF2_MIN_ITERATIONS });
    expect(sealed).toMatchObject({ v: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations: PBKDF2_MIN_ITERATIONS });
    expect(JSON.stringify(sealed)).not.toContain('"a"');
    expect(await openSecrets(PASSWORD, sealed)).toEqual(keys);
    await expect(openSecrets('другой пароль', sealed)).rejects.toMatchObject({ code: 'wrong_password' });
  });

  it('rejects a blob that decrypts to something else', async () => {
    const { sealText } = await import('../../db');
    const alien = await sealText(PASSWORD, JSON.stringify({ v: SEALED_SECRETS_VERSION + 1, anthropic: 'x' }), { iterations: PBKDF2_MIN_ITERATIONS });
    await expect(openSecrets(PASSWORD, alien)).rejects.toBeInstanceOf(CryptoError);
  });
});

describe('enabling the lock', () => {
  it('moves the keys out of the stored settings into the sealed blob and stays unlocked', async () => {
    await withKeys();
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 });

    const stored = await getStoredSettings();
    expect(stored.lock).toMatchObject({ enabled: true, kind: 'password', autoLockMinutes: 5 });
    expect(stored.lock.sealedSecrets).not.toBeNull();
    const raw = JSON.stringify(await db.settings.get('settings'));
    for (const key of ['sk-ant-AAAA', 'sk-oa-BBBB', 'sk-stt-CCCC', PASSWORD]) expect(raw).not.toContain(key);

    expect(useLockStore.getState().status).toBe('unlocked');
    expect((await getSettings()).ai.anthropic.apiKey).toBe('sk-ant-AAAA');
  });

  it('refuses a short password or PIN', async () => {
    await expect(enableLock('abc', { kind: 'password', autoLockMinutes: 5 })).rejects.toBeInstanceOf(LockError);
    await expect(enableLock('12', { kind: 'pin', autoLockMinutes: 5 })).rejects.toBeInstanceOf(LockError);
    expect((await getStoredSettings()).lock.enabled).toBe(false);
  });
});

describe('locking and unlocking', () => {
  it('a new launch starts locked, hides the keys, and a wrong password does not open it', async () => {
    await withKeys();
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 });

    // "Restart": nothing in memory, only the database.
    expect(await initLock()).toBe('locked');
    expect(getSessionSecrets()).toBeNull();
    expect((await getSettings()).ai.anthropic.apiKey).toBe('');

    expect(await unlock('неверный пароль')).toBe('wrong');
    expect(useLockStore.getState().status).toBe('locked');
    expect((await getSettings()).ai.anthropic.apiKey).toBe('');

    expect(await unlock(PASSWORD)).toBe('ok');
    expect(useLockStore.getState().status).toBe('unlocked');
    expect((await getSettings()).ai.anthropic.apiKey).toBe('sk-ant-AAAA');
    expect((await getSettings()).stt.apiKey).toBe('sk-stt-CCCC');
  });

  it('lockNow forgets the keys again', async () => {
    await withKeys();
    await enableLock('482913', { kind: 'pin', autoLockMinutes: 0 });
    lockNow();
    expect(useLockStore.getState().status).toBe('locked');
    expect((await getSettings()).ai.anthropic.apiKey).toBe('');
  });

  it('slows down repeated wrong attempts', async () => {
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 });
    lockNow();
    const t0 = 1_000_000;
    expect(await unlock('x', t0)).toBe('wrong');
    expect(await unlock('x', t0)).toBe('wrong');
    expect(await unlock('x', t0)).toBe('wrong'); // the third one starts a delay
    expect(secondsUntilRetry(t0)).toBe(throttleSeconds(3));
    expect(await unlock(PASSWORD, t0 + 500)).toBe('wait');
    expect(await unlock(PASSWORD, t0 + 60_000)).toBe('ok');
  });

  it('keeps the delay across a reload', async () => {
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 });
    lockNow();
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) expect(await unlock('x', t0)).toBe('wrong');
    await initLock(); // a reload
    expect(secondsUntilRetry(t0)).toBe(throttleSeconds(3));
    expect(await unlock(PASSWORD, t0 + 100)).toBe('wait');
    expect(await unlock(PASSWORD, t0 + 3_000)).toBe('ok');
    await initLock();
    lockNow();
    expect(secondsUntilRetry(t0)).toBe(0);
  });

  it('throttle grows and is capped', () => {
    expect([1, 2, 3, 4, 5, 20].map(throttleSeconds)).toEqual([0, 0, 2, 4, 8, 60]);
  });
});

describe('changing and removing the lock', () => {
  it('changes the password: the old one stops working, the keys survive', async () => {
    await withKeys();
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 });
    await expect(changePassword('не тот', 'новый-пароль-1', 'password')).rejects.toMatchObject({ code: 'wrong_password' });
    await changePassword(PASSWORD, 'новый-пароль-1', 'password');

    await initLock();
    expect(await unlock(PASSWORD)).toBe('wrong');
    expect(await unlock('новый-пароль-1', Date.now() + 120_000)).toBe('ok');
    expect((await getSettings()).ai.openaiCompat.apiKey).toBe('sk-oa-BBBB');
  });

  it('turning it off needs the password and puts the keys back into the settings', async () => {
    await withKeys();
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 });
    await expect(disableLock('не тот')).rejects.toMatchObject({ code: 'wrong_password' });
    expect((await getStoredSettings()).lock.enabled).toBe(true);

    await disableLock(PASSWORD);
    const stored = await getStoredSettings();
    expect(stored.lock).toMatchObject({ enabled: false, sealedSecrets: null, verifier: '' });
    expect(stored.ai.anthropic.apiKey).toBe('sk-ant-AAAA');
    expect(useLockStore.getState().status).toBe('off');
  });
});

describe('saving a key', () => {
  it('without the lock goes to the settings, trimmed', async () => {
    await saveApiKeys({ anthropic: '  sk-ant-NEW  ' });
    expect((await getStoredSettings()).ai.anthropic.apiKey).toBe('sk-ant-NEW');
  });

  it('with the lock goes into the sealed blob only, other keys kept', async () => {
    await withKeys();
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 });
    await saveApiKeys({ anthropic: 'sk-ant-ROTATED' });

    expect(JSON.stringify(await db.settings.get('settings'))).not.toContain('sk-ant-ROTATED');
    expect((await getSettings()).ai.anthropic.apiKey).toBe('sk-ant-ROTATED');

    await initLock();
    await unlock(PASSWORD);
    const settings = await getSettings();
    expect(settings.ai.anthropic.apiKey).toBe('sk-ant-ROTATED');
    expect(settings.ai.openaiCompat.apiKey).toBe('sk-oa-BBBB');
  });

  it('is refused while the app is locked', async () => {
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 });
    lockNow();
    await expect(saveApiKeys({ anthropic: 'x' })).rejects.toMatchObject({ code: 'not_unlocked' });
  });
});

describe('validateNewPassword', () => {
  it('checks length, digits-only PIN and the repeat', () => {
    expect(validateNewPassword('password', 'abcdef', 'abcdef')).toBeNull();
    expect(validateNewPassword('password', 'abc', 'abc')).toMatch(/короче/);
    expect(validateNewPassword('pin', '12a4', '12a4')).toMatch(/цифр/);
    expect(validateNewPassword('pin', '1234', '1234')).toBeNull();
    expect(validateNewPassword('password', 'abcdef', 'abcdeg')).toMatch(/Повтор/);
  });
});

describe('the lock uses Argon2id and upgrades locks made by earlier versions', () => {
  const cheap = { m: 64, t: 1, p: 1 };

  it('a new lock checks the password and seals the keys with Argon2id, from one salt', async () => {
    setLockArgon2(cheap);
    await withKeys();
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 });
    const { lock } = await getStoredSettings();
    expect(lock.argon2).toEqual(cheap);
    expect(lock.iterations).toBe(0);
    expect(lock.sealedSecrets).toMatchObject({ v: 2, kdf: 'Argon2id', salt: lock.salt, ...cheap });

    lockNow();
    expect(await unlock('не тот')).toBe('wrong');
    expect(await unlock(PASSWORD)).toBe('ok');
    expect(getSessionSecrets()).toEqual({ anthropic: 'sk-ant-AAAA', openaiCompat: 'sk-oa-BBBB', stt: 'sk-stt-CCCC' });
  });

  it('saving a key again keeps the salt and cost, so an unlock stays one derivation', async () => {
    setLockArgon2(cheap);
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 });
    const before = (await getStoredSettings()).lock;
    await saveApiKeys({ anthropic: 'sk-new' });
    const after = (await getStoredSettings()).lock;
    expect(after.sealedSecrets).toMatchObject({ v: 2, salt: before.salt });
    expect(after.sealedSecrets?.salt).toBe(after.salt);
    expect(after.sealedSecrets?.data).not.toBe(before.sealedSecrets?.data);
    lockNow();
    expect(await unlock(PASSWORD)).toBe('ok');
    expect(getSessionSecrets()?.anthropic).toBe('sk-new');
  });

  it('the sealed keys cannot be swapped for a backup of the same password', async () => {
    setLockArgon2(cheap);
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 });
    const { lock } = await getStoredSettings();
    const { sealText } = await import('../../db');
    const foreign = await sealText(PASSWORD, JSON.stringify({ v: SEALED_SECRETS_VERSION, anthropic: 'evil', openaiCompat: '', stt: '' }), { argon2: cheap, salt: lock.salt, aad: 'orbita/backup/v1' });
    await expect(openSecrets(PASSWORD, foreign)).rejects.toMatchObject({ code: 'wrong_password' });
  });

  it('a lock made with PBKDF2 keeps working, and becomes Argon2id on the next successful unlock', async () => {
    await withKeys();
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 }); // PBKDF2 (test knob)
    let { lock } = await getStoredSettings();
    expect(lock.argon2).toBeUndefined();
    expect(lock.sealedSecrets).toMatchObject({ v: 1, kdf: 'PBKDF2-SHA256' });

    setLockIterations(undefined); // from now on, as the real app: Argon2id at the app-wide cost
    lockNow();
    expect(await unlock('не тот')).toBe('wrong');
    expect((await getStoredSettings()).lock.argon2).toBeUndefined(); // a wrong password changes nothing
    expect(await unlock(PASSWORD)).toBe('ok');
    expect(getSessionSecrets()).toEqual({ anthropic: 'sk-ant-AAAA', openaiCompat: 'sk-oa-BBBB', stt: 'sk-stt-CCCC' });

    lock = (await getStoredSettings()).lock;
    expect(lock.argon2).toMatchObject({ m: 32_768, t: 3, p: 1 });
    expect(lock.iterations).toBe(0);
    expect(lock.sealedSecrets).toMatchObject({ v: 2, kdf: 'Argon2id', salt: lock.salt });

    lockNow();
    expect(await unlock(PASSWORD)).toBe('ok'); // and the upgraded lock opens
    expect(getSessionSecrets()?.anthropic).toBe('sk-ant-AAAA');
  }, 60_000);

  it('turning the lock off clears the Argon2id cost', async () => {
    setLockArgon2(cheap);
    await enableLock(PASSWORD, { kind: 'password', autoLockMinutes: 5 });
    await disableLock(PASSWORD);
    const { lock } = await getStoredSettings();
    expect(lock).toMatchObject({ enabled: false, iterations: 0, verifier: '' });
    expect(lock.argon2).toBeUndefined();
  });
});
