import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AbortedError,
  BadKeyError,
  BadResponseError,
  CorsError,
  OfflineError,
  ProviderError,
  RateLimitError,
  TimeoutError,
} from './errors';
import { redact, requestJson, requestStream } from './http';
import { jsonReply, scriptedFetch, testHttp, textReply } from './testing';

const URL = 'https://api.example.test/v1/x';
const request = { headers: { 'content-type': 'application/json' }, body: '{}' };

afterEach(() => vi.unstubAllGlobals());

describe('requestJson', () => {
  it('returns the parsed body of a successful response', async () => {
    const { fetch, requests } = scriptedFetch(jsonReply({ ok: true }));
    await expect(requestJson(URL, request, testHttp(fetch))).resolves.toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ url: URL, method: 'POST' });
  });

  it('turns a non-JSON success body into BadResponseError', async () => {
    const { fetch } = scriptedFetch(textReply('<html>gateway</html>'));
    await expect(requestJson(URL, request, testHttp(fetch))).rejects.toBeInstanceOf(BadResponseError);
  });
});

describe('error mapping', () => {
  it.each([401, 403])('maps %i to BadKeyError', async (status) => {
    const { fetch, requests } = scriptedFetch(jsonReply({ error: { message: 'invalid x-api-key' } }, status));
    await expect(requestJson(URL, request, testHttp(fetch))).rejects.toBeInstanceOf(BadKeyError);
    expect(requests).toHaveLength(1);
  });

  it('maps other 4xx to ProviderError with the provider text, without retrying', async () => {
    const { fetch, requests } = scriptedFetch(jsonReply({ error: { message: 'model not found' } }, 404));
    const error = await requestJson(URL, request, testHttp(fetch)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toBe('Провайдер вернул ошибку 404: model not found');
    expect(requests).toHaveLength(1);
  });

  it('does not retry billing problems that look like rate limits', async () => {
    const { fetch, requests } = scriptedFetch(jsonReply({ error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } }, 429));
    const error = await requestJson(URL, request, testHttp(fetch)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(requests).toHaveLength(1);
  });

  it('never leaks the key or key-like strings, and ignores HTML error pages', async () => {
    const key = 'sk-secret-1234567890abcdef';
    const { fetch } = scriptedFetch(jsonReply({ error: { message: `Incorrect API key: ${key} / sk-other-ABCDEFGH1234` } }, 400));
    const error = (await requestJson(URL, request, testHttp(fetch, { secrets: [key] })).catch((e: unknown) => e)) as ProviderError;
    expect(error.message).not.toContain('secret');
    expect(error.message).not.toContain('ABCDEFGH1234');
    expect(error.message).toContain('***');

    const html = scriptedFetch(textReply('<html><body>Bad gateway</body></html>', 400));
    const htmlError = (await requestJson(URL, request, testHttp(html.fetch)).catch((e: unknown) => e)) as ProviderError;
    expect(htmlError.message).toBe('Провайдер вернул ошибку 400');
  });

  it('redact masks listed secrets of reasonable length only', () => {
    expect(redact('key=abcdefgh12 and ab', ['abcdefgh12', 'ab'])).toBe('key=*** and ab');
  });
});

describe('retries', () => {
  it('retries 5xx with exponential back-off and then succeeds', async () => {
    const { fetch, requests } = scriptedFetch(textReply('', 503), textReply('', 502), jsonReply({ done: 1 }));
    const sleep = vi.fn(async (_ms: number) => undefined);
    await expect(requestJson(URL, request, testHttp(fetch, { sleep }))).resolves.toEqual({ done: 1 });
    expect(requests).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([800, 1600]);
  });

  it('honors Retry-After on 429', async () => {
    const { fetch } = scriptedFetch(jsonReply({}, 429, { 'retry-after': '3' }), jsonReply({ ok: 1 }));
    const sleep = vi.fn(async (_ms: number) => undefined);
    await requestJson(URL, request, testHttp(fetch, { sleep }));
    expect(sleep.mock.calls[0][0]).toBe(3000);
  });

  it('gives up after 3 retries with RateLimitError', async () => {
    const { fetch, requests } = scriptedFetch(jsonReply({}, 429));
    const error = await requestJson(URL, request, testHttp(fetch)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(requests).toHaveLength(4);
  });

  it('gives up with ProviderError when 5xx never ends', async () => {
    const { fetch, requests } = scriptedFetch(textReply('', 500));
    const error = await requestJson(URL, request, testHttp(fetch, { maxRetries: 1 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(500);
    expect(requests).toHaveLength(2);
  });

  it('does not wait out an absurdly long Retry-After', async () => {
    const { fetch, requests } = scriptedFetch(jsonReply({}, 429, { 'retry-after': '3600' }));
    const error = await requestJson(URL, request, testHttp(fetch)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfterMs).toBe(3_600_000);
    expect(requests).toHaveLength(1);
  });
});

describe('network failures', () => {
  it('reports CORS-like failures (a bare TypeError while online)', async () => {
    const { fetch } = scriptedFetch(new TypeError('Failed to fetch'));
    await expect(requestJson(URL, request, testHttp(fetch))).rejects.toBeInstanceOf(CorsError);
  });

  it('reports Offline when the browser knows it has no network', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const { fetch } = scriptedFetch(new TypeError('Failed to fetch'));
    await expect(requestJson(URL, request, testHttp(fetch))).rejects.toBeInstanceOf(OfflineError);
  });

  it('times out when the server does not answer', async () => {
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const error = await requestJson(URL, request, testHttp(hanging, { timeoutMs: 20 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TimeoutError);
  });

  it('cancels with AbortedError, before and during the request', async () => {
    const early = new AbortController();
    early.abort();
    const { fetch, requests } = scriptedFetch(jsonReply({}));
    await expect(requestJson(URL, { ...request, signal: early.signal }, testHttp(fetch))).rejects.toBeInstanceOf(AbortedError);
    expect(requests).toHaveLength(0);

    const late = new AbortController();
    const hanging = (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        queueMicrotask(() => late.abort());
      });
    await expect(requestJson(URL, { ...request, signal: late.signal }, testHttp(hanging))).rejects.toBeInstanceOf(AbortedError);
  });

  it('stops waiting between retries when cancelled', async () => {
    const controller = new AbortController();
    const { fetch } = scriptedFetch(textReply('', 503));
    const sleep = vi.fn(async () => {
      controller.abort();
      throw new AbortedError();
    });
    await expect(requestJson(URL, { ...request, signal: controller.signal }, testHttp(fetch, { sleep }))).rejects.toBeInstanceOf(AbortedError);
  });
});

describe('requestStream', () => {
  it('resolves with the response once headers arrive', async () => {
    const { fetch } = scriptedFetch(textReply('data: x\n\n'));
    const response = await requestStream(URL, request, testHttp(fetch));
    expect(await response.text()).toBe('data: x\n\n');
  });

  it('applies the same error mapping', async () => {
    const { fetch } = scriptedFetch(jsonReply({ error: 'bad key' }, 401));
    await expect(requestStream(URL, request, testHttp(fetch))).rejects.toBeInstanceOf(BadKeyError);
  });
});
