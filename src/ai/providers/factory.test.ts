import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usageRepo, wipeAll } from '../../db';
import { defaultSettings, mergeSettings } from '../../db/settings';
import type { SettingsPatch } from '../../db/settings';
import { jsonReply, scriptedFetch, testHttp } from '../testing';
import { forgetLearnedCapabilities } from './capabilities';
import { checkAiReadiness, createAiServices, createLlmProvider, createSttProvider, isMockAiBuild } from './factory';
import { sharedManualProvider } from './manual';

beforeEach(async () => {
  forgetLearnedCapabilities();
  await wipeAll();
});

const settings = (patch: SettingsPatch = {}) => mergeSettings(defaultSettings(), patch);

describe('createLlmProvider', () => {
  it('builds the provider named in the settings', () => {
    expect(createLlmProvider(settings({ ai: { provider: 'anthropic' } }), { mock: false }).id).toBe('anthropic');
    expect(createLlmProvider(settings({ ai: { provider: 'openai-compat' } }), { mock: false }).id).toBe('openai-compat');
    expect(createLlmProvider(settings({ ai: { provider: 'manual' } }), { mock: false })).toBe(sharedManualProvider);
  });

  it('uses the deterministic provider when asked, whatever the settings say', () => {
    expect(createLlmProvider(settings({ ai: { provider: 'anthropic' } }), { mock: true }).id).toBe('mock');
    vi.stubEnv('VITE_MOCK_AI', '');
    expect(isMockAiBuild()).toBe(false);
    vi.unstubAllEnvs();
  });

  it('passes keys, models and the endpoint through, and records usage in the database by default', async () => {
    const { fetch, requests } = scriptedFetch(jsonReply({ content: [{ type: 'text', text: 'ок' }], usage: { input_tokens: 12, output_tokens: 3 } }));
    const llm = createLlmProvider(
      settings({ ai: { provider: 'anthropic', anthropic: { apiKey: 'sk-ant-factory-key-123', models: { fast: 'claude-haiku-5-5', smart: 'claude-sonnet-5-5' } } } }),
      { mock: false, http: testHttp(fetch) },
    );
    expect(await llm.test()).toMatchObject({ ok: true });
    expect(requests[0].headers['x-api-key']).toBe('sk-ant-factory-key-123');

    const rows = await usageRepo.listRange('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5', purpose: 'test', inputTokens: 12, outputTokens: 3 });
    expect(rows[0].costUsd).toBeGreaterThan(0);
  });

  it('records nothing with onUsage: null and calls a custom sink otherwise', async () => {
    const quiet = createLlmProvider(settings(), { mock: true, onUsage: null });
    await quiet.chat({ system: '', messages: [{ role: 'user', content: 'x' }], purpose: 'ask' });
    expect(await usageRepo.listRange('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z')).toHaveLength(0);

    const sink = vi.fn();
    await createLlmProvider(settings(), { mock: true, onUsage: sink }).chat({ system: '', messages: [{ role: 'user', content: 'x' }], purpose: 'ask' });
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ provider: 'mock' }), 'ask');
  });
});

describe('createSttProvider', () => {
  it('builds browser and OpenAI-compatible recognizers', () => {
    expect(createSttProvider(settings({ stt: { provider: 'browser' } }), { mock: false }).id).toBe('browser');
    expect(createSttProvider(settings({ stt: { provider: 'openai-compat' } }), { mock: false }).id).toBe('openai-compat');
    expect(createSttProvider(settings(), { mock: true }).id).toBe('mock');
  });

  it('reuses the LLM key when the recognizer has none and lives on the same server, and records audio seconds', async () => {
    const { fetch, requests } = scriptedFetch(jsonReply({ text: 'привет', duration: 7 }));
    const stt = createSttProvider(
      settings({ stt: { provider: 'openai-compat', apiKey: '', baseUrl: 'https://stt.example.test/v1', model: 'whisper-1' }, ai: { openaiCompat: { apiKey: 'sk-shared-key-0123456', baseUrl: 'https://stt.example.test/v1' } } }),
      { mock: false, http: testHttp(fetch) },
    );
    await stt.transcribe(new Blob(['audio'], { type: 'audio/webm' }), { lang: 'ru' });
    expect(requests[0].url).toBe('https://stt.example.test/v1/audio/transcriptions');
    expect(requests[0].headers.authorization).toBe('Bearer sk-shared-key-0123456');

    const rows = await usageRepo.listRange('2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z');
    expect(rows[0]).toMatchObject({ purpose: 'transcribe', audioSec: 7, inputTokens: 0, model: 'whisper-1' });
  });

  it('createAiServices returns both', () => {
    const services = createAiServices(settings(), { mock: true });
    expect([services.llm.id, services.stt.id]).toEqual(['mock', 'mock']);
  });
});

describe('checkAiReadiness', () => {
  it('needs a key for the hosted providers', () => {
    const anthropic = checkAiReadiness(settings({ ai: { provider: 'anthropic' } }), { mock: false });
    expect(anthropic.ready).toBe(false);
    expect(anthropic.reason).toContain('Anthropic');
    expect(checkAiReadiness(settings({ ai: { provider: 'anthropic', anthropic: { apiKey: 'k' } } }), { mock: false }).ready).toBe(true);
    expect(checkAiReadiness(settings({ ai: { provider: 'openai-compat' } }), { mock: false }).ready).toBe(false);
  });

  it('is ready without a key for the clipboard mode, local servers and the mock', () => {
    expect(checkAiReadiness(settings({ ai: { provider: 'manual' } }), { mock: false }).ready).toBe(true);
    expect(checkAiReadiness(settings({ ai: { provider: 'openai-compat', openaiCompat: { baseUrl: 'http://localhost:11434/v1' } } }), { mock: false }).ready).toBe(true);
    expect(checkAiReadiness(settings({ ai: { provider: 'anthropic' } }), { mock: true }).ready).toBe(true);
  });

  describe('speech key fallback', () => {
    it('lends the LLM key to speech recognition only on the same server', async () => {
      const base = { ai: { provider: 'openai-compat' as const, openaiCompat: { apiKey: 'sk-llm-secret-123', baseUrl: 'https://api.openai.com/v1' } } };
      const same = scriptedFetch(jsonReply({ text: 'привет' }));
      await createSttProvider(settings({ ...base, stt: { provider: 'openai-compat', apiKey: '', baseUrl: 'https://api.openai.com/v1' } }), { mock: false, http: testHttp(same.fetch) }).transcribe(new Blob(['a'], { type: 'audio/webm' }), { lang: 'ru' });
      expect(JSON.stringify(same.requests[0].headers)).toContain('sk-llm-secret-123');

      const other = scriptedFetch(jsonReply({ text: 'привет' }));
      await createSttProvider(settings({ ...base, stt: { provider: 'openai-compat', apiKey: '', baseUrl: 'https://api.groq.com/openai/v1' } }), { mock: false, http: testHttp(other.fetch) })
        .transcribe(new Blob(['a'], { type: 'audio/webm' }), { lang: 'ru' })
        .catch(() => undefined);
      expect(JSON.stringify(other.requests[0]?.headers ?? {})).not.toContain('sk-llm-secret-123');
    });
  });
});
