import type { AiModels, UsagePurpose } from '../../domain/types';
import { NoKeyError } from '../errors';
import { estimateCostUsd } from './pricing';
import type { ModelTier, SttUsage, SttUsageSink, Usage } from './types';
import { t } from '../../i18n';

/** Plumbing shared by the network providers. */

/** Receives the tokens of every real request (repairs and connection tests included). */
export type UsageSink = (usage: Usage, purpose: UsagePurpose) => void | Promise<void>;

export interface ProviderHooks {
  onUsage?: UsageSink;
}

export const DEFAULT_STRUCTURED_MAX_TOKENS = 8_192;
export const DEFAULT_CHAT_MAX_TOKENS = 4_096;

export function pickModel(request: { model?: string; tier?: ModelTier }, models: AiModels): string {
  return request.model ?? models[request.tier ?? 'fast'];
}

export function requireKey(apiKey: string): string {
  const key = apiKey.trim();
  if (key === '') throw new NoKeyError();
  return key;
}

export function makeUsage(provider: string, model: string, inputTokens: number, outputTokens: number): Usage {
  const costUsd = estimateCostUsd(model, inputTokens, outputTokens);
  return { provider, model, inputTokens, outputTokens, ...(costUsd !== undefined && { costUsd }) };
}

/** Adds up the usage of the calls that made one logical request. */
export function sumUsage(provider: string, model: string, parts: readonly Pick<Usage, 'inputTokens' | 'outputTokens'>[]): Usage {
  const inputTokens = parts.reduce((total, part) => total + part.inputTokens, 0);
  const outputTokens = parts.reduce((total, part) => total + part.outputTokens, 0);
  return makeUsage(provider, model, inputTokens, outputTokens);
}

/** Usage bookkeeping must never fail a request that already succeeded. */
export async function reportUsage(sink: UsageSink | undefined, usage: Usage, purpose: UsagePurpose): Promise<void> {
  if (!sink) return;
  try {
    await sink(usage, purpose);
  } catch (error) {
    console.error(t('Could not record token usage'), error);
  }
}

export async function reportSttUsage(sink: SttUsageSink | undefined, usage: SttUsage): Promise<void> {
  if (!sink) return;
  try {
    await sink(usage);
  } catch (error) {
    console.error(t('Could not record recognition usage'), error);
  }
}

/** A JSON value from a provider response, narrowed without trusting its shape. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Local servers (Ollama, LM Studio) need no key. */
export function isLocalAddress(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local') || /^(10|192\.168)\./.test(host);
  } catch {
    return false;
  }
}

/** Trims, drops the trailing slash, defaults an empty address to OpenAI and adds `https://` to a bare host. */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed === '') return OPENAI_BASE_URL;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
