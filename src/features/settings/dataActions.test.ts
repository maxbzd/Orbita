import { beforeEach, describe, expect, it } from 'vitest';
import { createMockLlmProvider } from '../../ai';
import { audioRepo, capturesRepo, getSettings, itemsRepo, peopleRepo, profileRepo, setSessionSecrets, updateSettings, wipeAll } from '../../db';
import { PBKDF2_MIN_ITERATIONS } from '../../domain/schemas';
import { initLock, setLockIterations } from '../lock';
import {
  countRawMaterial,
  deleteRawMaterial,
  eraseAll,
  makeEncryptedBackup,
  makePlainBackup,
  previewBackup,
  recomputeDerived,
  runImport,
} from './dataActions';

beforeEach(async () => {
  setLockIterations(PBKDF2_MIN_ITERATIONS);
  await wipeAll();
  setSessionSecrets(null);
  await initLock();
});

async function seedLife() {
  const capture = await capturesRepo.create({ kind: 'voice', text: 'Решил поднять цену на интенсив', rawText: 'решил поднять цену на интенсив', status: 'done' });
  await audioRepo.save(capture.id, new Blob(['voice'], { type: 'audio/webm' }));
  await itemsRepo.create({ kind: 'task', title: 'Поднять цену', captureId: capture.id });
  await peopleRepo.create({ name: 'Маша' });
  await profileRepo.save({ name: 'Фёдор', glossary: [{ term: 'OKR' }] });
  await updateSettings({ ai: { anthropic: { apiKey: 'sk-ant-SECRET' } }, theme: 'light' });
  return capture;
}

describe('export and import', () => {
  it('a plain copy never carries API keys and restores everything else', async () => {
    await seedLife();
    const file = await makePlainBackup(false);
    expect(file.fileName).toMatch(/^orbita-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(file.text).not.toContain('sk-ant-SECRET');

    await wipeAll();
    const preview = await previewBackup(file.text);
    expect(preview.info.encrypted).toBe(false);
    expect(preview.counts).toMatchObject({ captures: 1, items: 1, people: 1 });

    const report = await runImport(file.text, 'merge');
    expect(report.added).toBeGreaterThan(0);
    expect((await capturesRepo.list()).map((c) => c.text)).toEqual(['Решил поднять цену на интенсив']);
    expect((await getSettings()).theme).toBe('light');
    expect((await getSettings()).ai.anthropic.apiKey).toBe('');
    expect((await profileRepo.get()).glossary).toEqual([{ term: 'OKR' }]);
  });

  it('an encrypted copy needs its password, keeps the keys inside and rejects a wrong password', async () => {
    await seedLife();
    const file = await makeEncryptedBackup('пароль-копии', false, PBKDF2_MIN_ITERATIONS);
    expect(file.fileName).toMatch(/\.enc\.json$/);
    expect(file.text).not.toContain('sk-ant-SECRET');
    expect(file.text).not.toContain('Фёдор');

    const locked = await previewBackup(file.text);
    expect(locked.info.encrypted).toBe(true);
    expect(locked.counts).toBeNull();
    await expect(previewBackup(file.text, 'не тот')).rejects.toMatchObject({ message: expect.stringMatching(/парол/i) });
    expect((await previewBackup(file.text, 'пароль-копии')).counts).toMatchObject({ captures: 1 });

    await wipeAll();
    await expect(runImport(file.text, 'replace', 'не тот')).rejects.toBeTruthy();
    await runImport(file.text, 'replace', 'пароль-копии');
    expect((await getSettings()).ai.anthropic.apiKey).toBe('sk-ant-SECRET');
    expect(await capturesRepo.list()).toHaveLength(1);
  });

  it('replace swaps the data for the file; merge keeps what is there', async () => {
    await seedLife();
    const file = await makePlainBackup(false);
    await peopleRepo.create({ name: 'Новый человек' });

    await runImport(file.text, 'merge');
    expect((await peopleRepo.list()).map((p) => p.name).sort()).toEqual(['Маша', 'Новый человек']);

    await runImport(file.text, 'replace');
    expect((await peopleRepo.list()).map((p) => p.name)).toEqual(['Маша']);
  });

  it('refuses a file that is not a backup, with a readable reason', async () => {
    await expect(previewBackup('{"hello":1}')).rejects.toMatchObject({ code: 'not_a_backup' });
    await expect(previewBackup('not json')).rejects.toMatchObject({ code: 'invalid_json' });
  });
});

describe('raw material and derived data are separate', () => {
  it('deleting the raw material removes audio and original text only', async () => {
    const capture = await seedLife();
    expect(await countRawMaterial()).toEqual({ recordings: 1, rawTexts: 1 });

    expect(await deleteRawMaterial()).toEqual({ recordings: 1, rawTexts: 1 });
    const after = await capturesRepo.get(capture.id);
    expect(after?.audioId).toBeUndefined();
    expect(after?.rawText).toBeUndefined();
    expect(after?.text).toBe('Решил поднять цену на интенсив');
    expect(await audioRepo.getForCapture(capture.id)).toBeUndefined();
    expect(await itemsRepo.list()).toHaveLength(1);
    expect(await countRawMaterial()).toEqual({ recordings: 0, rawTexts: 0 });
  });

  it('recomputing derived data leaves records, objects and audio alone', async () => {
    const capture = await seedLife();
    const result = await recomputeDerived(createMockLlmProvider({ delayMs: 0, onUsage: undefined }));
    expect(result.reviews).toBe(2);
    expect(await capturesRepo.get(capture.id)).toMatchObject({ text: 'Решил поднять цену на интенсив' });
    expect(await audioRepo.getForCapture(capture.id)).toBeDefined();
    expect(await itemsRepo.list()).toHaveLength(1);
  });

  it('erase-all empties every table including settings', async () => {
    await seedLife();
    await eraseAll();
    expect(await capturesRepo.list()).toHaveLength(0);
    expect((await getSettings()).ai.anthropic.apiKey).toBe('');
    expect((await profileRepo.get()).glossary).toEqual([]);
  });
});
