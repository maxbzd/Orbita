import type { ZodType } from 'zod';
import type { UsagePurpose } from '../../domain/types';

/** Contract of the AI layer, see docs/ARCHITECTURE.md "Слой ИИ". Additions are marked with "extension". */

/** `mock` is an extension: the deterministic provider for tests and `VITE_MOCK_AI=1`. */
export type LlmProviderId = 'anthropic' | 'openai-compat' | 'manual' | 'mock';

export type Role = 'user' | 'assistant';

export interface Msg {
  role: Role;
  content: string;
}

/** Tokens and (when the price is known) cost of one logical call, repair request included. */
export interface Usage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Estimate from the built-in price table; absent for unknown models. */
  costUsd?: number;
}

/** Extension: which of the two configured models to use when `model` is not given. Default `fast`. */
export type ModelTier = 'fast' | 'smart';

interface CallBase {
  /** Explicit model id; wins over `tier`. */
  model?: string;
  tier?: ModelTier;
  signal?: AbortSignal;
  purpose: UsagePurpose;
}

export interface StructuredRequest<T> extends CallBase {
  system: string;
  user: string;
  schemaName: string;
  /** What the model is told (see `toModelJsonSchema`). */
  jsonSchema: object;
  /** What the answer is validated against. */
  zod: ZodType<T>;
  maxTokens?: number;
}

export interface ChatRequest extends CallBase {
  system: string;
  messages: Msg[];
  maxTokens?: number;
  /** Called with each piece of text as it arrives. */
  onToken?(token: string): void;
}

export interface StructuredResult<T> {
  data: T;
  usage: Usage;
}

export interface ChatResult {
  text: string;
  usage: Usage;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
  chat(request: ChatRequest): Promise<ChatResult>;
  test(): Promise<{ ok: boolean; message: string }>;
}

// ───────── Speech to text ─────────

export type SttProviderId = 'browser' | 'openai-compat' | 'mock';

export interface TranscribeOptions {
  /** BCP-47 language code, e.g. `ru`. */
  lang: string;
  /** Vocabulary hint (glossary terms): improves recognition of niche words. */
  prompt?: string;
  /** Length of the recording when known (extension): used for the usage counter if the server does not say. */
  durationSec?: number;
  signal?: AbortSignal;
}

export interface TranscribeResult {
  text: string;
  durationSec?: number;
}

export interface SttProvider {
  readonly id: SttProviderId;
  transcribe(blob: Blob, options: TranscribeOptions): Promise<TranscribeResult>;
}

/** Seconds of audio recognized by one request, for the usage counter. */
export interface SttUsage {
  provider: string;
  model: string;
  audioSec: number;
  costUsd?: number;
}

export type SttUsageSink = (usage: SttUsage) => void | Promise<void>;
