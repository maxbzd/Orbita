import { beforeEach, describe, expect, it } from 'vitest';
import { wipeAll } from './maintenance';
import {
  defaultSettings,
  getSettings,
  getStoredSettings,
  mergeSettings,
  normalizeSettings,
  resetSettings,
  setSessionSecrets,
  updateSettings,
} from './settings';
import { db } from './schema';

beforeEach(wipeAll);

describe('defaults', () => {
  it('provides a complete settings object nobody shares', () => {
    const a = defaultSettings();
    const b = defaultSettings();
    expect(a).toMatchObject({
      id: 'settings',
      theme: 'dark',
      ai: { provider: 'anthropic', anthropic: { apiKey: '', models: { fast: 'claude-haiku-5-5', smart: 'claude-sonnet-5-5' } } },
      stt: { provider: 'browser', language: 'ru' },
      lock: { enabled: false, sealedSecrets: null },
      locale: { language: 'ru' },
      autoAccept: { enabled: false, minConfidence: 0.85 },
      capture: { defaultContext: null, keepAudio: true },
      privacy: { contextLevel: 'full' },
      onboarding: { done: false },
    });
    a.ai.anthropic.apiKey = 'changed';
    expect(b.ai.anthropic.apiKey).toBe('');
  });

  it('is what getSettings returns before anything is saved', async () => {
    expect(await getSettings()).toEqual(defaultSettings());
    expect(await db.settings.count()).toBe(0);
  });
});

describe('normalizeSettings', () => {
  it.each([[undefined], [null], ['text'], [42], [[]]])('turns %j into the defaults', (raw) => {
    expect(normalizeSettings(raw)).toEqual(defaultSettings());
  });

  it('keeps valid values, replaces invalid ones with defaults and drops unknown keys', () => {
    const settings = normalizeSettings({
      theme: 'light',
      ai: { provider: 'nonsense', anthropic: { apiKey: 'sk-1', models: { fast: 42 } } },
      autoAccept: { enabled: true, minConfidence: 7 },
      lock: 'broken',
      surprise: true,
    });
    expect(settings.theme).toBe('light');
    expect(settings.ai.provider).toBe('anthropic');
    expect(settings.ai.anthropic.apiKey).toBe('sk-1');
    expect(settings.ai.anthropic.models).toEqual({ fast: 'claude-haiku-5-5', smart: 'claude-sonnet-5-5' });
    expect(settings.autoAccept).toEqual({ enabled: true, minConfidence: 0.85 });
    expect(settings.lock).toEqual(defaultSettings().lock);
    expect('surprise' in settings).toBe(false);
  });
});

describe('mergeSettings', () => {
  it('changes only what the patch names, at any depth', () => {
    const base = mergeSettings(defaultSettings(), { ai: { anthropic: { apiKey: 'sk-1' } } });
    const next = mergeSettings(base, { ai: { anthropic: { models: { fast: 'my-model' } } }, theme: 'light' });
    expect(next.ai.anthropic).toEqual({ apiKey: 'sk-1', models: { fast: 'my-model', smart: 'claude-sonnet-5-5' } });
    expect(next.theme).toBe('light');
    expect(next.stt).toEqual(base.stt);
  });

  it('ignores undefined values and cannot be corrupted by a bad patch', () => {
    const base = mergeSettings(defaultSettings(), { theme: 'light' });
    const next = mergeSettings(base, { theme: undefined, privacy: { contextLevel: 'bogus' as never } });
    expect(next.theme).toBe('light');
    expect(next.privacy.contextLevel).toBe('full');
  });

  it('does not mutate its input', () => {
    const base = defaultSettings();
    mergeSettings(base, { ai: { anthropic: { apiKey: 'x' } } });
    expect(base.ai.anthropic.apiKey).toBe('');
  });
});

describe('persistence', () => {
  it('saves a patch and reads it back merged with the defaults', async () => {
    await updateSettings({ ai: { openaiCompat: { baseUrl: 'http://localhost:11434/v1' } } });
    await updateSettings({ onboarding: { done: true, completedAt: '2026-10-07T10:00:00.000Z' } });
    const settings = await getSettings();
    expect(settings.ai.openaiCompat.baseUrl).toBe('http://localhost:11434/v1');
    expect(settings.onboarding).toEqual({ done: true, completedAt: '2026-10-07T10:00:00.000Z' });
    expect(await db.settings.count()).toBe(1);
  });

  it('survives a corrupt stored row', async () => {
    await db.settings.put({ id: 'settings', theme: 'neon', ai: 7 } as never);
    expect((await getSettings()).theme).toBe('dark');
    expect((await updateSettings({ theme: 'light' })).theme).toBe('light');
  });

  it('resets to the defaults', async () => {
    await updateSettings({ theme: 'light', ai: { anthropic: { apiKey: 'sk-1' } } });
    expect(await resetSettings()).toEqual(defaultSettings());
    expect(await getSettings()).toEqual(defaultSettings());
  });
});

describe('looks and capture settings (defaults added later)', () => {
  it('fills the new fields in rows saved before they existed', async () => {
    // A row written by an older version: no `ui`, no `capture.walkMode`, no `lock.kind`.
    await db.settings.put({ id: 'settings', theme: 'light', capture: { defaultContext: 'walk', keepAudio: false }, lock: { enabled: false } } as never);
    const settings = await getSettings();
    expect(settings.ui).toEqual({ effects: 'auto', reduceMotion: false });
    expect(settings.capture).toEqual({ defaultContext: 'walk', keepAudio: false, walkMode: true });
    expect(settings.lock.kind).toBe('password');
  });

  it('merges one looks field without touching the other', async () => {
    await updateSettings({ ui: { effects: 'min' } });
    const next = await updateSettings({ ui: { reduceMotion: true } });
    expect(next.ui).toEqual({ effects: 'min', reduceMotion: true });
    expect(next.theme).toBe('dark');
  });

  it('repairs an invalid effects value instead of failing', () => {
    expect(mergeSettings(defaultSettings(), { ui: { effects: 'turbo' as never } }).ui.effects).toBe('auto');
  });
});

describe('API keys while the lock is on', () => {
  beforeEach(() => setSessionSecrets(null));

  it('never writes plain keys to the database and hands them out from memory once unlocked', async () => {
    await updateSettings({ ai: { anthropic: { apiKey: 'sk-ant-secret' } } });
    expect((await getStoredSettings()).ai.anthropic.apiKey).toBe('sk-ant-secret');

    await updateSettings({ lock: { enabled: true } });
    expect((await getStoredSettings()).ai.anthropic.apiKey).toBe('');
    expect((await getSettings()).ai.anthropic.apiKey).toBe('');

    setSessionSecrets({ anthropic: 'sk-ant-secret', openaiCompat: 'sk-oa', stt: 'sk-stt' });
    const unlocked = await getSettings();
    expect(unlocked.ai.anthropic.apiKey).toBe('sk-ant-secret');
    expect(unlocked.ai.openaiCompat.apiKey).toBe('sk-oa');
    expect(unlocked.stt.apiKey).toBe('sk-stt');

    // A later update, even one that names a key, leaves the stored fields blank.
    await updateSettings({ theme: 'light', ai: { anthropic: { apiKey: 'sk-leak' } } });
    const raw = JSON.stringify(await db.settings.get('settings'));
    expect(raw).not.toContain('sk-leak');
    expect(raw).not.toContain('sk-ant-secret');
    expect((await getSettings()).ai.anthropic.apiKey).toBe('sk-ant-secret');
  });

  it('does nothing to the keys when the lock is off, even with a session set', async () => {
    setSessionSecrets({ anthropic: 'in-memory', openaiCompat: '', stt: '' });
    expect((await getSettings()).ai.anthropic.apiKey).toBe('');
  });
});
