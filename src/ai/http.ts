import {
  AbortedError,
  AiError,
  BadKeyError,
  BadResponseError,
  CorsError,
  OfflineError,
  ProviderError,
  RateLimitError,
  TimeoutError,
} from './errors';
import { t } from '../i18n';

/**
 * The only place of the AI layer that talks to `fetch`: timeouts, cancellation, retries with
 * exponential back-off on 429/5xx and the mapping of every failure to a typed, Russian-language error.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpConfig {
  /** Injected in tests; defaults to the global `fetch` (looked up on every call, so it can be stubbed). */
  fetch?: FetchLike;
  /** Limit for one attempt: until the response is complete (JSON) or until its headers (streaming). */
  timeoutMs?: number;
  /** Repeats after the first attempt for 429/5xx. */
  maxRetries?: number;
  /** Replaced by a no-op in tests. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  /** Strings (API keys) that must never appear in an error message. */
  secrets?: readonly string[];
}

export interface HttpRequest {
  method?: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: BodyInit;
  signal?: AbortSignal;
}

export const DEFAULT_TIMEOUT_MS = 90_000;
export const DEFAULT_MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 800;
const BACKOFF_MAX_MS = 10_000;
/** A provider asking for a longer pause than this is not waited for: the error goes to the user. */
const MAX_RETRY_AFTER_MS = 30_000;
const MAX_PROVIDER_MESSAGE = 300;

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AbortedError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ───────── Error mapping ─────────

/** Replaces keys (and anything shaped like one) so that provider echoes never reach the UI or storage. */
export function redact(text: string, secrets: readonly string[] = []): string {
  let result = text;
  for (const secret of secrets) {
    if (secret.length >= 8) result = result.split(secret).join('***');
  }
  return result.replace(/\b(sk|gsk|key)-[A-Za-z0-9_-]{8,}/g, '$1-***');
}

function providerMessage(body: string): string | undefined {
  const trimmed = body.trim();
  if (trimmed === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const error = record.error;
      if (typeof error === 'string') return error;
      if (typeof error === 'object' && error !== null) {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === 'string') return message;
      }
      if (typeof record.message === 'string') return record.message;
      if (typeof record.detail === 'string') return record.detail;
    }
  } catch {
    // Not JSON (a proxy page, plain text): fall through and use the raw text.
  }
  // HTML error pages tell the user nothing useful.
  return /^\s*</.test(trimmed) ? undefined : trimmed;
}

/** Billing problems come back as 429 or 400 but repeating the request never helps. */
const QUOTA_PATTERN = /insufficient[_ ]quota|exceeded your current quota|credit balance|billing|payment required/i;

function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export function errorFromResponse(status: number, body: string, headers: Headers, secrets: readonly string[] = []): AiError {
  const raw = providerMessage(body);
  const message = raw === undefined ? undefined : redact(raw, secrets).slice(0, MAX_PROVIDER_MESSAGE);
  if (status === 401 || status === 403) return new BadKeyError(status);
  if (status === 429 || status === 402) {
    if (status === 402 || (message !== undefined && QUOTA_PATTERN.test(message))) {
      return new ProviderError(status, message ?? t('the provider account has run out of funds or quota'));
    }
    return new RateLimitError(parseRetryAfter(headers.get('retry-after')), status);
  }
  return new ProviderError(status, message);
}

function isRetryableStatus(error: AiError): boolean {
  if (error instanceof RateLimitError) return true;
  return error instanceof ProviderError && error.status !== undefined && (error.status >= 500 || error.status === 408);
}

function isAbortLike(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

// ───────── Requests ─────────

interface AttemptState {
  timedOut: boolean;
}

async function attemptOnce<T>(
  url: string,
  request: HttpRequest,
  config: HttpConfig,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const fetchImpl = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const state: AttemptState = { timedOut: false };
  const { signal } = request;

  if (signal?.aborted) throw new AbortedError();
  const onUserAbort = () => controller.abort();
  signal?.addEventListener('abort', onUserAbort, { once: true });
  const timer = setTimeout(() => {
    state.timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: request.method ?? 'POST',
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw errorFromResponse(response.status, body, response.headers, config.secrets);
    }
    return await read(response);
  } catch (error) {
    if (error instanceof AiError) throw error;
    if (signal?.aborted) throw new AbortedError();
    if (state.timedOut) throw new TimeoutError(timeoutMs / 1000);
    if (isAbortLike(error)) throw new AbortedError();
    if (isOffline()) throw new OfflineError(error);
    // `fetch` rejects with a bare TypeError for CORS, DNS and refused connections alike.
    if (error instanceof TypeError) throw new CorsError(error);
    throw new BadResponseError(error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
}

async function execute<T>(
  url: string,
  request: HttpRequest,
  config: HttpConfig,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const wait = config.sleep ?? sleep;
  const random = config.random ?? Math.random;

  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptOnce(url, request, config, read);
    } catch (error) {
      if (!(error instanceof AiError) || !isRetryableStatus(error) || attempt >= maxRetries) throw error;
      const requested = error instanceof RateLimitError ? error.retryAfterMs : undefined;
      if (requested !== undefined && requested > MAX_RETRY_AFTER_MS) throw error;
      const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt) + Math.floor(random() * 250);
      await wait(requested ?? backoff, request.signal);
    }
  }
}

/** POST/GET that resolves to the parsed JSON body of a successful response. */
export function requestJson(url: string, request: HttpRequest, config: HttpConfig = {}): Promise<unknown> {
  return execute(url, request, config, async (response) => {
    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new BadResponseError(t("The provider's response is not JSON: {v}", { v: redact(text, config.secrets).slice(0, 120) }));
    }
  });
}

/** Like `requestJson`, but resolves as soon as the headers arrive so the body can be streamed. */
export function requestStream(url: string, request: HttpRequest, config: HttpConfig = {}): Promise<Response> {
  return execute(url, request, config, async (response) => {
    if (response.body === null) throw new BadResponseError(t('The provider did not send a data stream'));
    return response;
  });
}
