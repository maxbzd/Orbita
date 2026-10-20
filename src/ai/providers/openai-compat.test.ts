import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AbortedError, BadKeyError, BadResponseError, NoKeyError, ProviderError } from '../errors';
import { jsonReply, scriptedFetch, sseReply, testHttp } from '../testing';
import { forgetLearnedCapabilities } from './capabilities';
import { createOpenAiCompatProvider } from './openai-compat';
import type { Usage } from './types';

beforeEach(forgetLearnedCapabilities);

const MODELS = { fast: 'gpt-4o-mini', smart: 'gpt-4o' };
const Out = z.object({ title: z.string(), n: z.number() });
const jsonSchema = { type: 'object', properties: { title: { type: 'string' }, n: { type: 'number' } }, required: ['title', 'n'], additionalProperties: false };
const request = { system: 'SYS', user: 'USER', schemaName: 'My Result', jsonSchema, zod: Out, purpose: 'extract' as const };

const completion = (content: string | null, extra: Record<string, unknown> = {}, usage = { prompt_tokens: 50, completion_tokens: 10 }) => ({
  id: 'c1',
  choices: [{ index: 0, message: { role: 'assistant', content, ...extra }, finish_reason: 'stop' }],
  usage,
});
const badRequest = (message: string, status = 400) => jsonReply({ error: { message, type: 'invalid_request_error' } }, status);

function setup(replies: Parameters<typeof scriptedFetch>, baseUrl = 'https://api.example.test/v1/', apiKey = 'sk-test-key-0123456789') {
  const { fetch, requests } = scriptedFetch(...replies);
  const onUsage = vi.fn<(usage: Usage, purpose: string) => void>();
  const provider = createOpenAiCompatProvider({ apiKey, baseUrl, models: MODELS, http: testHttp(fetch), onUsage });
  return { provider, requests, onUsage };
}

describe('structured', () => {
  it('posts to {baseUrl}/chat/completions with strict json_schema and a bearer key', async () => {
    const { provider, requests, onUsage } = setup([jsonReply(completion('{"title":"Привет","n":2}'))]);
    const result = await provider.structured(request);

    expect(result.data).toEqual({ title: 'Привет', n: 2 });
    expect(result.usage).toMatchObject({ provider: 'openai-compat', model: 'gpt-4o-mini', inputTokens: 50, outputTokens: 10 });
    expect(requests[0].url).toBe('https://api.example.test/v1/chat/completions');
    expect(requests[0].headers.authorization).toBe('Bearer sk-test-key-0123456789');
    expect(requests[0].body).toMatchObject({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'USER' },
      ],
      max_tokens: 8192,
      response_format: { type: 'json_schema', json_schema: { name: 'My_Result', strict: true, schema: jsonSchema } },
    });
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 50 }), 'extract');
  });

  it('falls back from json_schema to json_object and puts the schema into the prompt, remembering the lesson', async () => {
    const { provider, requests } = setup([
      badRequest("Invalid schema for response_format 'My_Result': 'additionalProperties' is required"),
      jsonReply(completion('{"title":"a","n":1}')),
      jsonReply(completion('{"title":"b","n":2}')),
    ]);
    expect((await provider.structured(request)).data).toEqual({ title: 'a', n: 1 });
    expect((await provider.structured(request)).data).toEqual({ title: 'b', n: 2 });

    const second = requests[1].body as { response_format: unknown; messages: { content: string }[] };
    expect(second.response_format).toEqual({ type: 'json_object' });
    expect(second.messages[0].content).toContain('SYS');
    expect(second.messages[0].content).toContain('JSON Schema');
    expect(second.messages[0].content).toContain('"additionalProperties":false');
    // The third request goes straight to json_object.
    expect(requests).toHaveLength(3);
    expect((requests[2].body as { response_format: unknown }).response_format).toEqual({ type: 'json_object' });
  });

  it('falls back all the way to a plain prompt when the server knows no response_format', async () => {
    const { provider, requests } = setup([
      badRequest('response_format.json_schema is not supported by this model'),
      badRequest("'response_format' of type 'json_object' is not supported with this model"),
      jsonReply(completion('Конечно!\n```json\n{"title":"c","n":3}\n```')),
    ]);
    expect((await provider.structured(request)).data).toEqual({ title: 'c', n: 3 });
    expect('response_format' in (requests[2].body as object)).toBe(false);
  });

  it('switches to max_completion_tokens when the model demands it', async () => {
    const { provider, requests } = setup([
      badRequest("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."),
      jsonReply(completion('{"title":"a","n":1}')),
    ]);
    await provider.structured({ ...request, maxTokens: 1234 });
    expect(requests[1].body).toMatchObject({ max_completion_tokens: 1234 });
    expect('max_tokens' in (requests[1].body as object)).toBe(false);
  });

  it('repairs once: second request carries the problem, usage is summed', async () => {
    const { provider, requests, onUsage } = setup([
      jsonReply(completion('{"title":7}', {}, { prompt_tokens: 100, completion_tokens: 5 })),
      jsonReply(completion('{"title":"ok","n":1}', {}, { prompt_tokens: 160, completion_tokens: 8 })),
    ]);
    const result = await provider.structured(request);
    expect(result.usage).toMatchObject({ inputTokens: 260, outputTokens: 13 });
    expect((requests[1].body as { messages: { content: string }[] }).messages[1].content).toContain('Problem:');
    expect(onUsage).toHaveBeenCalledTimes(2);
  });

  it('fails with BadResponseError after one repair, and explains a length cut-off', async () => {
    const cut = { choices: [{ message: { content: '{"title":"x","n"' }, finish_reason: 'length' }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    const { provider, requests } = setup([jsonReply(cut)]);
    const error = (await provider.structured(request).catch((e: unknown) => e)) as BadResponseError;
    expect(error).toBeInstanceOf(BadResponseError);
    expect(error.detail).toContain('output token limit');
    expect(requests).toHaveLength(2);
  });

  it('handles array content parts and rejects refusals and empty choices', async () => {
    const parts = { choices: [{ message: { content: [{ type: 'text', text: '{"title":"p",' }, { type: 'text', text: '"n":1}' }] } }] };
    expect((await setup([jsonReply(parts)]).provider.structured(request)).data).toEqual({ title: 'p', n: 1 });

    const refusal = setup([jsonReply(completion(null, { refusal: 'Не могу помочь' }))]);
    await expect(refusal.provider.structured(request)).rejects.toBeInstanceOf(BadResponseError);
    expect(refusal.requests).toHaveLength(1);

    await expect(setup([jsonReply({ choices: [] })]).provider.structured(request)).rejects.toBeInstanceOf(BadResponseError);
  });
});

describe('keys and addresses', () => {
  it('throws NoKeyError for a hosted endpoint without a key, before any request', async () => {
    const { provider, requests } = setup([jsonReply({})], 'https://api.example.test/v1', '');
    await expect(provider.structured(request)).rejects.toBeInstanceOf(NoKeyError);
    expect(requests).toHaveLength(0);
  });

  it('works without a key against a local server and sends no Authorization header', async () => {
    const { provider, requests } = setup([jsonReply(completion('{"title":"l","n":1}'))], 'http://localhost:11434/v1', '');
    await provider.structured(request);
    expect(requests[0].headers.authorization).toBeUndefined();
  });

  it('defaults an empty address to OpenAI and adds https:// to a bare host', async () => {
    const empty = setup([jsonReply(completion('{"title":"a","n":1}'))], '  ');
    await empty.provider.structured(request);
    expect(empty.requests[0].url).toBe('https://api.openai.com/v1/chat/completions');

    const bare = setup([jsonReply(completion('{"title":"a","n":1}'))], 'api.groq.com/openai/v1');
    await bare.provider.structured(request);
    expect(bare.requests[0].url).toBe('https://api.groq.com/openai/v1/chat/completions');
  });

  it('maps 401 to BadKeyError', async () => {
    const { provider } = setup([jsonReply({ error: { message: 'Incorrect API key provided: sk-test-key-0123456789' } }, 401)]);
    await expect(provider.structured(request)).rejects.toBeInstanceOf(BadKeyError);
  });

  it('does not hide an unrelated 400', async () => {
    const { provider, requests } = setup([badRequest('The model `gpt-9` does not exist')]);
    const error = await provider.structured(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(requests).toHaveLength(1);
  });
});

const chunk = (content: string) => ({ data: { choices: [{ delta: { content } }] } });

describe('chat', () => {
  const chatRequest = { system: 'SYS', messages: [{ role: 'user' as const, content: 'Привет' }], purpose: 'ask' as const };

  it('streams deltas to onToken and takes usage from the final chunk', async () => {
    const { provider, requests, onUsage } = setup([
      sseReply([
        { data: { choices: [{ delta: { role: 'assistant', content: '' } }] } },
        chunk('Пр'),
        chunk('ивет 👋'),
        { data: { choices: [{ delta: {}, finish_reason: 'stop' }] } },
        { data: { choices: [], usage: { prompt_tokens: 30, completion_tokens: 6 } } },
        { data: '[DONE]' },
      ]),
    ]);
    const tokens: string[] = [];
    const result = await provider.chat({ ...chatRequest, onToken: (token) => tokens.push(token) });
    expect(tokens).toEqual(['Пр', 'ивет 👋']);
    expect(result).toMatchObject({ text: 'Привет 👋', usage: { inputTokens: 30, outputTokens: 6 } });
    expect(requests[0].body).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'Привет' },
      ],
    });
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ outputTokens: 6 }), 'ask');
  });

  it('drops stream_options when the server rejects them, and estimates usage when none is sent', async () => {
    const { provider, requests } = setup([badRequest("Unknown parameter: 'stream_options'"), sseReply([chunk('ответ'), { data: '[DONE]' }])]);
    const result = await provider.chat(chatRequest);
    expect('stream_options' in (requests[1].body as object)).toBe(false);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it('turns an in-stream error object into ProviderError', async () => {
    const { provider } = setup([sseReply([chunk('нача'), { data: { error: { message: 'upstream exploded' } } }])]);
    await expect(provider.chat(chatRequest)).rejects.toBeInstanceOf(ProviderError);
  });

  it('can be cancelled between tokens', async () => {
    const controller = new AbortController();
    const { provider } = setup([sseReply([chunk('a'), chunk('b'), chunk('c'), { data: '[DONE]' }])]);
    const attempt = provider.chat({ ...chatRequest, signal: controller.signal, onToken: () => controller.abort() });
    await expect(attempt).rejects.toBeInstanceOf(AbortedError);
  });

  it('rejects an empty answer', async () => {
    const { provider } = setup([sseReply([{ data: '[DONE]' }])]);
    await expect(provider.chat(chatRequest)).rejects.toBeInstanceOf(BadResponseError);
  });
});

describe('test()', () => {
  it('reports success and records usage as "test"', async () => {
    const { provider, onUsage } = setup([jsonReply(completion('ок'))]);
    expect(await provider.test()).toEqual({ ok: true, message: 'Соединение работает. Модель: gpt-4o-mini.' });
    expect(onUsage).toHaveBeenCalledWith(expect.anything(), 'test');
  });

  it('reports a missing key as a message, not an exception', async () => {
    const { provider } = setup([jsonReply({})], 'https://api.example.test/v1', '');
    const result = await provider.test();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('ключ');
  });
});
