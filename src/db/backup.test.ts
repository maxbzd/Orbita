import { beforeEach, describe, expect, it } from 'vitest';
import { PBKDF2_MIN_ITERATIONS } from '../domain/schemas';
import {
  BACKUP_FORMAT,
  BackupError,
  backupFileName,
  exportBackup,
  exportEncryptedBackup,
  importBackup,
  inspectBackup,
  readBackup,
  redactSecrets,
  serializeBackup,
} from './backup';
import type { PlainBackup } from './backup';
import { wipeAll } from './maintenance';
import {
  audioRepo,
  capturesRepo,
  checkinsRepo,
  itemsRepo,
  linksRepo,
  patternsRepo,
  peopleRepo,
  presetsRepo,
  profileRepo,
  projectsRepo,
  reviewsRepo,
  usageRepo,
} from './repos';
import { db } from './schema';
import { getSettings, updateSettings } from './settings';

const iterations = PBKDF2_MIN_ITERATIONS;
const API_KEY = 'sk-ant-very-secret-key';

beforeEach(wipeAll);

/** A little of everything, including a permanent deletion (tombstone) and a recording. */
async function seed() {
  const person = await peopleRepo.create({ name: 'Маша', aliases: ['Мария'], role: 'student' });
  const project = await projectsRepo.create({ name: 'Онлайн-школа', kind: 'business' });
  const capture = await capturesRepo.create({
    kind: 'voice',
    text: 'Решил поднять цену до пяти тысяч',
    day: '2026-10-07',
    createdAt: '2026-10-07T09:00:00.000Z',
    personIds: [person.id],
    projectIds: [project.id],
    status: 'done',
  });
  await audioRepo.save(capture.id, new Blob(['voice-bytes'], { type: 'audio/webm' }));
  const decision = await itemsRepo.create({ kind: 'decision', title: 'Поднять цену', chosen: 'Да', captureId: capture.id, reviewAt: '2026-11-01T00:00:00.000Z' });
  const prediction = await itemsRepo.create({ kind: 'prediction', title: 'Конверсия вырастет', probability: 0.7, captureId: capture.id });
  await itemsRepo.resolvePrediction(prediction.id, 'true');
  await itemsRepo.create({ kind: 'commitment', title: 'Отправить договор', direction: 'i_owe', counterpartyId: person.id });
  await checkinsRepo.create({ valence: 0.4, energy: 0.6, at: '2026-10-07T10:00:00.000Z', day: '2026-10-07', tags: ['сон'] });
  await patternsRepo.create({ title: 'Откладываю по вечерам', description: 'd', kind: 'behavior', evidence: [{ captureId: capture.id, day: '2026-10-07', quote: 'опять потом' }] });
  await reviewsRepo.upsert({ period: 'week', startDay: '2026-10-05', endDay: '2026-10-11', headline: 'Неделя', sections: [{ id: 's', title: 'Итоги', kind: 'text', body: 'ok', data: { n: 1 } }] });
  await profileRepo.save({ name: 'Лев', about: 'Консультант', glossary: [{ term: 'OKR', hint: 'экзамен' }] });
  await presetsRepo.create({ name: 'Утренний разбор', personIds: [person.id] });
  await linksRepo.create({ from: decision.id, to: prediction.id, kind: 'caused' });
  await usageRepo.record({ at: '2026-10-07T09:01:00.000Z', provider: 'anthropic', model: 'm', purpose: 'extract', inputTokens: 10, outputTokens: 5 });
  await updateSettings({ theme: 'light', ai: { anthropic: { apiKey: API_KEY } }, onboarding: { done: true } });
  const doomed = await capturesRepo.create({ kind: 'text', text: 'удалённая навсегда' });
  await capturesRepo.destroy(doomed.id);
  return { person, project, capture, decision, prediction, doomed };
}

/** The content of the database, comparable across runs (the export instant is dropped). */
async function snapshot() {
  const { tables } = await exportBackup({ includeAudio: true, includeSecrets: true });
  return tables;
}

describe('export', () => {
  it('describes itself and carries every table', async () => {
    const { capture } = await seed();
    const backup = await exportBackup();
    expect(backup).toMatchObject({ format: BACKUP_FORMAT, encrypted: false, schemaVersion: 2, includesAudio: false });
    expect(Number.isNaN(Date.parse(backup.exportedAt))).toBe(false);
    expect(backup.tables.captures.map((row) => row.id)).toContain(capture.id);
    expect(backup.tables.items).toHaveLength(3);
    expect(backup.tables.people).toHaveLength(1);
    expect(backup.tables.tombstones).toHaveLength(1);
    expect(backup.tables.profile?.name).toBe('Лев');
    expect(backup.tables.audio).toEqual([]);
  });

  it('exports an empty database as an empty backup', async () => {
    const backup = await exportBackup();
    expect(backup.tables.captures).toEqual([]);
    expect(backup.tables.settings).toBeNull();
    expect(backup.tables.profile).toBeNull();
  });

  it('puts audio in as base64 only when asked', async () => {
    const { capture } = await seed();
    const withAudio = await exportBackup({ includeAudio: true });
    expect(withAudio.includesAudio).toBe(true);
    expect(withAudio.tables.audio).toHaveLength(1);
    expect(withAudio.tables.audio[0]).toMatchObject({ captureId: capture.id, mime: 'audio/webm', sizeBytes: 11, data: btoa('voice-bytes') });
  });

  it('leaves API keys out of a plain file unless asked, and sealed secrets with them', async () => {
    await seed();
    const plain = await exportBackup();
    expect(JSON.stringify(plain)).not.toContain(API_KEY);
    expect(plain.tables.settings?.theme).toBe('light');
    expect(plain.tables.settings?.ai.anthropic.apiKey).toBe('');

    expect((await exportBackup({ includeSecrets: true })).tables.settings?.ai.anthropic.apiKey).toBe(API_KEY);
  });

  it('redactSecrets blanks every key without touching the rest', async () => {
    await updateSettings({ ai: { anthropic: { apiKey: 'a' }, openaiCompat: { apiKey: 'b' } }, stt: { apiKey: 'c' } });
    const redacted = redactSecrets(await getSettings());
    expect([redacted.ai.anthropic.apiKey, redacted.ai.openaiCompat.apiKey, redacted.stt.apiKey]).toEqual(['', '', '']);
    expect(redacted.lock.sealedSecrets).toBeNull();
    expect(redacted.ai.provider).toBe('anthropic');
  });

  it('names files by the local day', () => {
    expect(backupFileName({ encrypted: false, exportedAt: '2026-10-07T12:00:00.000Z' })).toBe('orbita-backup-2026-10-07.json');
    expect(backupFileName({ encrypted: true, exportedAt: '2026-10-07T12:00:00.000Z' })).toBe('orbita-backup-2026-10-07.enc.json');
  });
});

describe('round trip', () => {
  it('replace restores exactly what was exported, audio and secrets included', async () => {
    await seed();
    const before = await snapshot();
    const text = serializeBackup(await exportBackup({ includeAudio: true, includeSecrets: true }));

    await wipeAll();
    expect(await db.captures.count()).toBe(0);
    const report = await importBackup(text, { mode: 'replace' });

    expect(await snapshot()).toEqual(before);
    expect(report.mode).toBe('replace');
    expect(report.byTable.captures).toEqual({ added: 1, updated: 0, skipped: 0 });
    expect(report.added).toBeGreaterThan(10);
    expect((await (await audioRepo.getForCapture(before.captures[0]!.id))?.data.text())).toBe('voice-bytes');
  });

  it('keeps deletions for good: the tombstone travels and the deleted row does not come back', async () => {
    const { doomed } = await seed();
    const file = await exportBackup();
    await wipeAll();
    await importBackup(file, { mode: 'replace' });
    expect(await capturesRepo.get(doomed.id)).toBeUndefined();
    expect(await db.tombstones.get(doomed.id)).toMatchObject({ table: 'captures' });
  });

  it('serializes readably without audio and compactly with it', async () => {
    await seed();
    expect(serializeBackup(await exportBackup())).toContain('\n  "format"');
    expect(serializeBackup(await exportBackup({ includeAudio: true }))).not.toContain('\n');
  });

  it('keeps the local API key when the file has none (a plain backup), and takes the rest of the file', async () => {
    await seed();
    const file = await exportBackup();
    await updateSettings({ theme: 'dark' });
    await importBackup(file, { mode: 'replace' });
    const settings = await getSettings();
    expect(settings.ai.anthropic.apiKey).toBe(API_KEY);
    expect(settings.theme).toBe('light');
  });

  it('does not switch off the lock of this device when a replacing file has none', async () => {
    await seed();
    const file = await exportBackup();
    await updateSettings({ lock: { enabled: true, kind: 'password', salt: 'c2FsdA==', iterations: 600000, verifier: 'dmVyaWZpZXI=', autoLockMinutes: 5 } });
    await importBackup(file, { mode: 'replace' });
    const { lock } = await getSettings();
    expect(lock).toMatchObject({ enabled: true, verifier: 'dmVyaWZpZXI=' });
  });

  it('drops audio ids that point at recordings the file does not contain', async () => {
    const { capture } = await seed();
    const file = await exportBackup();
    await importBackup(file, { mode: 'replace' });
    const restored = await capturesRepo.get(capture.id);
    expect(restored).toBeDefined();
    expect(restored && 'audioId' in restored).toBe(false);
  });

  it('recomputes the mention counters instead of trusting the file (invariant 4)', async () => {
    const { person } = await seed();
    const file = await exportBackup();
    const liar = file.tables.people.find((row) => row.id === person.id)!;
    liar.mentionCount = 99;
    liar.lastMentionAt = '2030-01-01T00:00:00.000Z';

    await importBackup(file, { mode: 'replace' });

    expect(await peopleRepo.get(person.id)).toMatchObject({ mentionCount: 1, lastMentionAt: '2026-10-07T09:00:00.000Z' });
  });
});

describe('merge', () => {
  it('adds what is missing and imports twice without changes', async () => {
    const { person } = await seed();
    const file = await exportBackup({ includeAudio: true });
    await wipeAll();
    await peopleRepo.create({ name: 'Местный', id: 'local-only' });

    const first = await importBackup(file, { mode: 'merge' });
    expect(first.added).toBeGreaterThan(10);
    expect(await peopleRepo.get(person.id)).toBeDefined();
    expect(await peopleRepo.get('local-only')).toBeDefined();

    const second = await importBackup(file, { mode: 'merge' });
    expect(second.added).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.skipped).toBeGreaterThan(10);
  });

  it('keeps the side that changed last', async () => {
    const { person, decision } = await seed();
    const file = await exportBackup();
    const incomingPerson = file.tables.people.find((row) => row.id === person.id)!;
    incomingPerson.notes = 'из файла (новее)';
    incomingPerson.updatedAt = '2099-01-01T00:00:00.000Z';
    const incomingDecision = file.tables.items.find((row) => row.id === decision.id)!;
    incomingDecision.title = 'из файла (старее)';
    incomingDecision.updatedAt = '2000-01-01T00:00:00.000Z';

    const report = await importBackup(file, { mode: 'merge' });

    expect((await peopleRepo.get(person.id))?.notes).toBe('из файла (новее)');
    expect((await itemsRepo.get(decision.id))?.title).toBe('Поднять цену');
    expect(report.byTable.people.updated).toBe(1);
    expect(report.byTable.items.skipped).toBeGreaterThanOrEqual(1);
  });

  it('applies incoming tombstones to older local rows and spares rows edited since', async () => {
    const stale = await peopleRepo.create({ name: 'Устаревший', id: 'stale' });
    const edited = await peopleRepo.create({ name: 'Правленый', id: 'edited' });
    const file = await exportBackup();
    file.tables.people = [];
    file.tables.tombstones = [
      { id: stale.id, table: 'people', deletedAt: '2099-01-01T00:00:00.000Z' },
      { id: edited.id, table: 'people', deletedAt: '2000-01-01T00:00:00.000Z' },
    ];

    await importBackup(file, { mode: 'merge' });

    expect(await peopleRepo.get(stale.id)).toBeUndefined();
    expect(await db.tombstones.get(stale.id)).toBeDefined();
    expect(await peopleRepo.get(edited.id)).toBeDefined();
    expect(await db.tombstones.get(edited.id)).toBeUndefined();
  });

  it('does not resurrect a record deleted here, but revives one edited after its deletion', async () => {
    const gone = await peopleRepo.create({ name: 'Удалённый', id: 'gone' });
    const back = await peopleRepo.create({ name: 'Вернувшийся', id: 'back' });
    const file = await exportBackup();
    await peopleRepo.destroy(gone.id);
    await peopleRepo.destroy(back.id);
    await db.tombstones.update(back.id, { deletedAt: '2000-01-01T00:00:00.000Z' });

    await importBackup(file, { mode: 'merge' });

    expect(await peopleRepo.get(gone.id)).toBeUndefined();
    expect(await peopleRepo.get(back.id)).toBeDefined();
    expect(await db.tombstones.get(back.id)).toBeUndefined();
  });

  it('removes the recording of a capture deleted on the other device', async () => {
    const { capture } = await seed();
    const file = await exportBackup();
    file.tables.captures = file.tables.captures.filter((row) => row.id !== capture.id);
    file.tables.tombstones.push({ id: capture.id, table: 'captures', deletedAt: '2099-01-01T00:00:00.000Z' });

    await importBackup(file, { mode: 'merge' });

    expect(await capturesRepo.get(capture.id)).toBeUndefined();
    expect(await audioRepo.getForCapture(capture.id)).toBeUndefined();
  });

  it('takes settings only when this device has none', async () => {
    await seed();
    const file = await exportBackup({ includeSecrets: true });
    await importBackup(file, { mode: 'merge' });
    await updateSettings({ theme: 'dark' });
    expect((await importBackup(file, { mode: 'merge' })).byTable.settings).toEqual({ added: 0, updated: 0, skipped: 1 });
    expect((await getSettings()).theme).toBe('dark');

    await db.settings.clear();
    await importBackup(file, { mode: 'merge' });
    expect((await getSettings()).theme).toBe('light');
  });

  it('skips a recording whose capture is not there', async () => {
    const { capture } = await seed();
    const file = await exportBackup({ includeAudio: true });
    await wipeAll();
    file.tables.captures = file.tables.captures.filter((row) => row.id !== capture.id);
    const report = await importBackup(file, { mode: 'merge' });
    expect(report.byTable.audio).toEqual({ added: 0, updated: 0, skipped: 1 });
  });
});

describe('invalid files', () => {
  const expectCode = (promise: Promise<unknown>, code: string) =>
    expect(promise).rejects.toMatchObject({ name: 'BackupError', code });

  it('rejects text that is not JSON', async () => {
    await expectCode(importBackup('это не json'), 'invalid_json');
    await expectCode(readBackup(''), 'invalid_json');
  });

  it('rejects JSON that is not a backup', async () => {
    await expectCode(importBackup('{"hello":"world"}'), 'not_a_backup');
    await expectCode(importBackup('[1,2]'), 'not_a_backup');
    await expectCode(importBackup('null'), 'not_a_backup');
    await expectCode(importBackup('{"format":42}'), 'not_a_backup');
  });

  it('rejects other format versions and databases from a newer app', async () => {
    await expectCode(importBackup('{"format":"orbit-backup-v2"}'), 'unsupported_version');
    const file = await exportBackup();
    await expectCode(importBackup({ ...file, schemaVersion: 99 }), 'unsupported_version');
  });

  it('names the broken field in a Russian message and leaves the database untouched', async () => {
    await seed();
    const before = await snapshot();
    const file = await exportBackup();
    file.tables.items[0]!.title = '';
    const error = await importBackup(JSON.stringify(file), { mode: 'replace' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(BackupError);
    expect(error).toMatchObject({ code: 'invalid_data' });
    expect((error as Error).message).toMatch(/^Резервная копия повреждена \(tables\.items\[0\]\.title: /);
    expect(await snapshot()).toEqual(before);
  });

  it('rejects wrong types, bad enums and bad dates anywhere in the file', async () => {
    await seed();
    const mutate = async (change: (file: PlainBackup) => void) => {
      const file = await exportBackup();
      change(file);
      return importBackup(JSON.stringify(file));
    };
    await expectCode(mutate((file) => void (file.tables.captures[0]!.status = 'weird' as never)), 'invalid_data');
    await expectCode(mutate((file) => void (file.tables.checkins[0]!.valence = 5)), 'invalid_data');
    await expectCode(mutate((file) => void (file.tables.people[0]!.createdAt = 'yesterday')), 'invalid_data');
    await expectCode(mutate((file) => void ((file.tables as { captures: unknown }).captures = 'nope')), 'invalid_data');
    await expectCode(mutate((file) => void (file.exportedAt = 'sometime')), 'invalid_data');
  });

  it('does not import half of a file: a bad row anywhere cancels everything', async () => {
    await seed();
    const file = await exportBackup();
    await wipeAll();
    file.tables.reviews[0]!.period = 'decade' as never;
    await expectCode(importBackup(JSON.stringify(file)), 'invalid_data');
    expect(await db.captures.count()).toBe(0);
    expect(await db.people.count()).toBe(0);
  });

  it('repairs invalid settings instead of rejecting the file', async () => {
    await seed();
    const file = await exportBackup();
    (file.tables as { settings: unknown }).settings = { theme: 'neon', ai: 3 };
    await importBackup(JSON.stringify(file), { mode: 'replace' });
    expect((await getSettings()).theme).toBe('dark');
  });

  it('accepts a backup with only some tables', async () => {
    const minimal = { format: BACKUP_FORMAT, encrypted: false, exportedAt: '2026-10-07T12:00:00.000Z', tables: { people: [] } };
    const report = await importBackup(JSON.stringify(minimal));
    expect(report.added).toBe(0);
  });
});

describe('encrypted backup', () => {
  it('round-trips with the password and hides the content in the file', async () => {
    await seed();
    const before = await snapshot();
    const encrypted = await exportEncryptedBackup('пароль-на-копию', { includeAudio: true, iterations });
    const text = serializeBackup(encrypted);

    expect(encrypted).toMatchObject({ format: BACKUP_FORMAT, encrypted: true });
    expect(encrypted.sealed).toMatchObject({ alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iterations });
    for (const secret of ['Поднять цену', 'Маша', API_KEY, 'пароль-на-копию', btoa('voice-bytes')]) expect(text).not.toContain(secret);

    await wipeAll();
    await importBackup(text, { mode: 'replace', password: 'пароль-на-копию' });
    expect(await snapshot()).toEqual(before);
  });

  it('includes the API keys by default, since the file is sealed', async () => {
    await seed();
    const text = serializeBackup(await exportEncryptedBackup('p', { iterations }));
    await wipeAll();
    await importBackup(text, { mode: 'replace', password: 'p' });
    expect((await getSettings()).ai.anthropic.apiKey).toBe(API_KEY);
  });

  it('can leave the keys out on request', async () => {
    await seed();
    const file = await readBackup(serializeBackup(await exportEncryptedBackup('p', { iterations, includeSecrets: false })), 'p');
    expect(file.tables.settings?.ai.anthropic.apiKey).toBe('');
  });

  it('refuses a wrong password and changes nothing', async () => {
    await seed();
    const text = serializeBackup(await exportEncryptedBackup('верный', { iterations }));
    const before = await snapshot();
    const error = await importBackup(text, { mode: 'replace', password: 'неверный' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackupError);
    expect(error).toMatchObject({ code: 'wrong_password', message: 'Неверный пароль или файл повреждён.' });
    expect(await snapshot()).toEqual(before);
  });

  it('asks for a password when there is none', async () => {
    const text = serializeBackup(await exportEncryptedBackup('p', { iterations }));
    await expect(importBackup(text)).rejects.toMatchObject({ code: 'password_required' });
    await expect(importBackup(text, { password: '' })).rejects.toMatchObject({ code: 'password_required' });
  });

  it('refuses to export without a password', async () => {
    await expect(exportEncryptedBackup('')).rejects.toMatchObject({ code: 'password_required' });
  });

  it('detects tampering with the sealed data', async () => {
    const file = await exportEncryptedBackup('p', { iterations });
    const bytes = Uint8Array.from(atob(file.sealed.data), (char) => char.charCodeAt(0));
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    const tampered = { ...file, sealed: { ...file.sealed, data: btoa(String.fromCharCode(...bytes)) } };
    await expect(importBackup(JSON.stringify(tampered), { password: 'p' })).rejects.toMatchObject({ code: 'wrong_password' });
  });

  it('rejects an encrypted envelope with a weak work factor', async () => {
    const file = await exportEncryptedBackup('p', { iterations });
    const weak = { ...file, sealed: { ...file.sealed, iterations: 1000 } };
    await expect(importBackup(JSON.stringify(weak), { password: 'p' })).rejects.toMatchObject({ code: 'invalid_data' });
  });

  it('rejects a sealed document that is not a backup', async () => {
    const { sealText } = await import('./crypto');
    const file = await exportEncryptedBackup('p', { iterations });
    const forged = { ...file, sealed: await sealText('p', '{"format":"something-else"}', { iterations }) };
    await expect(importBackup(JSON.stringify(forged), { password: 'p' })).rejects.toMatchObject({ code: 'not_a_backup' });
  });

  it('can be told apart before asking for a password', async () => {
    const plain = serializeBackup(await exportBackup());
    const sealed = serializeBackup(await exportEncryptedBackup('p', { iterations }));
    expect(inspectBackup(plain)).toMatchObject({ encrypted: false });
    expect(inspectBackup(sealed)).toMatchObject({ encrypted: true });
    expect(() => inspectBackup('{"format":"nope"}')).toThrow(BackupError);
    expect(() => inspectBackup(`{"format":"${BACKUP_FORMAT}"}`)).toThrow('Резервная копия повреждена');
  });
});
