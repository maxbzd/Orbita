import { beforeEach, describe, expect, it, vi } from 'vitest';
import { peopleRepo } from './repos';
import { BackupError, importBackup, readBackup, serializeBackup } from './backup';
import { createAutoBackupKey, sealBackupToKey } from './backupKey';
import { wipeAll } from './maintenance';
import { runAutoBackup } from './autoBackup';
import { exportBackup } from './backup';
import { getStoredSettings, updateSettings } from './settings';

const folder = vi.hoisted(() => ({ files: [] as { name: string; text: string; prefix: string; keep: number }[], access: 'granted' as 'granted' | 'prompt' | 'none' }));
vi.mock('../lib/folder', () => ({
  folderAccess: async () => folder.access,
  writeToFolder: async (name: string, text: string, prefix: string, keep: number) => {
    folder.files.push({ name, text, prefix, keep });
  },
}));

const argon2 = { m: 64, t: 1, p: 1 };
beforeEach(async () => {
  await wipeAll();
  folder.files = [];
  folder.access = 'granted';
});

const setup = async (patch: object = {}) => {
  await updateSettings({ autoBackup: { ...(await createAutoBackupKey('pp-фраза', argon2)), folder: 'Документы', everyDays: 1, ...patch } });
};

describe('a copy sealed to a public key', () => {
  it('is made without any secret, holds nothing readable, and opens with the passphrase through the normal import', async () => {
    await updateSettings({ ai: { anthropic: { apiKey: 'sk-ant-secret' } } });
    await peopleRepo.create({ name: 'Ольга Сергеевна', role: 'client' });
    const config = await createAutoBackupKey('correct horse battery', argon2);
    expect(config.publicKey.length).toBeGreaterThan(1500); // X25519 + ML-KEM-768
    const text = JSON.stringify(await sealBackupToKey(await exportBackup(), config));
    for (const secret of ['Ольга', 'correct horse', 'sk-ant']) expect(text).not.toContain(secret);

    await expect(readBackup(text)).rejects.toMatchObject({ code: 'password_required' });
    await expect(readBackup(text, 'correct horse battery!')).rejects.toMatchObject({ code: 'wrong_password' });
    await wipeAll();
    await importBackup(text, { mode: 'replace', password: 'correct horse battery' });
    expect((await peopleRepo.list()).map((p) => p.name)).toEqual(['Ольга Сергеевна']);
  });

  it('refuses a damaged cost or salt instead of running it', async () => {
    const config = await createAutoBackupKey('pp', argon2);
    const file = await sealBackupToKey(await exportBackup(), config);
    const crash = (kdf: object) => readBackup(JSON.stringify({ ...file, kdf: { ...file.kdf, ...kdf } }), 'pp');
    await expect(crash({ m: 99_999_999 })).rejects.toThrow();
    await expect(crash({ salt: '***' })).rejects.toThrow();
  });

  it('a password-sealed file is not mistaken for it, nor the reverse', async () => {
    const file = JSON.stringify(await sealBackupToKey(await exportBackup(), await createAutoBackupKey('pp', argon2)));
    expect(JSON.parse(file).sealed).toBeUndefined();
    await expect(readBackup(file.replace('"kdf"', '"kdx"'), 'pp')).rejects.toBeInstanceOf(BackupError);
  });
});

describe('automatic backups into a folder', () => {
  it('does nothing until it is set up', async () => {
    expect(await runAutoBackup()).toBe('off');
    expect(folder.files).toHaveLength(0);
  });

  it('writes a dated, encrypted copy without recordings or API keys, and remembers when', async () => {
    await setup();
    await updateSettings({ ai: { anthropic: { apiKey: 'sk-ant-secret' } } });
    await peopleRepo.create({ name: 'Игорь Петров', role: 'client' });
    const now = Date.UTC(2026, 10, 3, 12);
    expect(await runAutoBackup({ now })).toBe('written');
    expect(folder.files).toHaveLength(1);
    const file = folder.files[0]!;
    expect(file.name).toBe('orbita-auto-2026-11-03.enc.json');
    expect(file.keep).toBe(14);
    expect(file.text).not.toContain('Игорь');
    expect(file.text).not.toContain('sk-ant');
    expect((await getStoredSettings()).autoBackup?.lastAt).toBe(now);
    await wipeAll();
    const back = await readBackup(file.text, 'pp-фраза');
    expect(back.tables.people.map((p) => p.name)).toEqual(['Игорь Петров']);
    expect(back.tables.settings?.ai.anthropic.apiKey).toBe('');
    expect(back.tables.settings?.autoBackup).toBeNull(); // the folder belongs to this device
  });

  it('waits for the next day, unless forced', async () => {
    await setup();
    const now = Date.UTC(2026, 10, 3, 12);
    await runAutoBackup({ now });
    expect(await runAutoBackup({ now: now + 3_600_000 })).toBe('not-due');
    expect(await runAutoBackup({ now: now + 25 * 3_600_000 })).toBe('written');
    expect(await runAutoBackup({ now: now + 26 * 3_600_000, force: true })).toBe('written');
  });

  it('asks for permission instead of failing when the browser forgot the folder', async () => {
    await setup();
    folder.access = 'prompt';
    expect(await runAutoBackup()).toBe('needs-permission');
    expect(folder.files).toHaveLength(0);
    expect((await getStoredSettings()).autoBackup?.lastAt).toBeUndefined();
  });

  it('a plain or encrypted export never carries the folder, and an import keeps this device\'s own', async () => {
    await setup();
    const file = JSON.parse(serializeBackup(await exportBackup({ includeSecrets: true })));
    expect(file.tables.settings.autoBackup).toBeNull();
    await importBackup(JSON.stringify(file), { mode: 'replace' });
    expect((await getStoredSettings()).autoBackup?.folder).toBe('Документы'); // restoring a file does not switch off this device's copies
  });
});
