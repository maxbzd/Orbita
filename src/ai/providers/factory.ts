import type { Settings } from '../../domain/types';
import type { HttpConfig } from '../http';
import { recordLlmUsage, recordSttUsage } from '../usage';
import { createAnthropicProvider } from './anthropic';
import { sharedManualProvider } from './manual';
import { createMockLlmProvider } from './mock';
import { isLocalAddress, normalizeBaseUrl } from './shared';
import type { UsageSink } from './shared';
import { createBrowserStt } from './stt/browser';
import { createMockStt } from './stt/mock';
import { createOpenAiCompatStt } from './stt/openai-compat';
import { createOpenAiCompatProvider } from './openai-compat';
import type { LlmProvider, SttProvider, SttUsageSink } from './types';
import { t } from '../../i18n';

/**
 * Builds the providers the settings ask for. Settings must carry the API keys in plain text: while the
 * app lock is on, the keys live encrypted and the lock layer passes a decrypted copy.
 */

export interface AiFactoryOptions {
  /** Force the deterministic providers on or off; by default `VITE_MOCK_AI=1` decides. */
  mock?: boolean;
  /** Artificial latency of the mock providers. */
  mockDelayMs?: number;
  http?: HttpConfig;
  /** Where token counts go; the default writes to the `usage` table, `null` records nothing. */
  onUsage?: UsageSink | null;
  onSttUsage?: SttUsageSink | null;
}

/** True when the build was started with `VITE_MOCK_AI=1`. */
export function isMockAiBuild(): boolean {
  return import.meta.env?.VITE_MOCK_AI === '1';
}

const useMock = (options: AiFactoryOptions): boolean => options.mock ?? isMockAiBuild();
const llmSink = (options: AiFactoryOptions): UsageSink | undefined => (options.onUsage === null ? undefined : (options.onUsage ?? recordLlmUsage));
const sttSink = (options: AiFactoryOptions): SttUsageSink | undefined =>
  options.onSttUsage === null ? undefined : (options.onSttUsage ?? recordSttUsage);

export function createLlmProvider(settings: Settings, options: AiFactoryOptions = {}): LlmProvider {
  const onUsage = llmSink(options);
  if (useMock(options)) return createMockLlmProvider({ onUsage, delayMs: options.mockDelayMs });

  switch (settings.ai.provider) {
    case 'anthropic':
      return createAnthropicProvider({ ...settings.ai.anthropic, http: options.http, onUsage });
    case 'openai-compat':
      return createOpenAiCompatProvider({ ...settings.ai.openaiCompat, http: options.http, onUsage });
    case 'manual':
      return sharedManualProvider;
  }
}

/** The LLM key may serve speech recognition only on the very same server: never carry it to another host. */
function sharedKey({ stt, ai }: Settings): string {
  return normalizeBaseUrl(stt.baseUrl) === normalizeBaseUrl(ai.openaiCompat.baseUrl) ? ai.openaiCompat.apiKey : '';
}

export function createSttProvider(settings: Settings, options: AiFactoryOptions = {}): SttProvider {
  const onUsage = sttSink(options);
  if (useMock(options)) return createMockStt({ onUsage, delayMs: options.mockDelayMs });

  switch (settings.stt.provider) {
    case 'browser':
      return createBrowserStt();
    case 'openai-compat':
      return createOpenAiCompatStt({
        apiKey: settings.stt.apiKey.trim() || sharedKey(settings),
        baseUrl: settings.stt.baseUrl,
        model: settings.stt.model,
        http: options.http,
        onUsage,
      });
  }
}

export interface AiServices {
  llm: LlmProvider;
  stt: SttProvider;
}

export function createAiServices(settings: Settings, options: AiFactoryOptions = {}): AiServices {
  return { llm: createLlmProvider(settings, options), stt: createSttProvider(settings, options) };
}

export interface AiReadiness {
  ready: boolean;
  /** Why not, in Russian, ready to show. */
  reason?: string;
}

/**
 * Whether automatic processing can run: a key (or a local server, the clipboard mode, the mock).
 * Without it a capture simply waits as "transcribed"; nothing is lost.
 */
export function checkAiReadiness(settings: Settings, options: Pick<AiFactoryOptions, 'mock'> = {}): AiReadiness {
  if (useMock(options)) return { ready: true };
  const { provider, anthropic, openaiCompat } = settings.ai;
  if (provider === 'manual') return { ready: true };
  if (provider === 'anthropic') {
    return anthropic.apiKey.trim() === '' ? { ready: false, reason: t('No Anthropic key set. Add it in Settings → AI.') } : { ready: true };
  }
  const hasKey = openaiCompat.apiKey.trim() !== '' || isLocalAddress(normalizeBaseUrl(openaiCompat.baseUrl));
  return hasKey ? { ready: true } : { ready: false, reason: t('No API key set. Add it in Settings → AI.') };
}
