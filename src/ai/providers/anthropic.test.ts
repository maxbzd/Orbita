import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AbortedError, BadKeyError, BadResponseError, NoKeyError, ProviderError } from '../errors';
import { hangingSseReply, jsonReply, scriptedFetch, sseReply, testHttp } from '../testing';
import { createAnthropicProvider } from './anthropic';
import { forgetLearnedCapabilities } from './capabilities';
import type { Usage } from './types';

beforeEach(forgetLearnedCapabilities);

const MODELS = { fast: 'claude-haiku-5-5', smart: 'claude-sonnet-5-5' };
const Out = z.object({ title: z.string(), n: z.number() });
const jsonSchema = { type: 'object', properties: { title: { type: 'string' }, n: { type: 'number' } }, required: ['title', 'n'] };

const toolMessage = (input: unknown, usage = { input_tokens: 100, output_tokens: 20 }) => ({
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  model: MODELS.fast,
  content: [
    { type: 'thinking', thinking: '' },
    { type: 'tool_use', id: 'tu_1', name: 'Result', input },
  ],
  stop_reason: 'tool_use',
  usage,
});

function setup(...replies: Parameters<typeof scriptedFetch>) {
  const { fetch, requests } = scriptedFetch(...replies);
  const onUsage = vi.fn<(usage: Usage, purpose: string) => void>();
  const provider = createAnthropicProvider({ apiKey: 'sk-ant-test-key-123456', models: MODELS, http: testHttp(fetch), onUsage });
  return { provider, requests, onUsage };
}

const request = { system: 'SYS', user: 'USER', schemaName: 'Result', jsonSchema, zod: Out, purpose: 'extract' as const };

describe('structured', () => {
  it('calls the Messages API with the browser-access headers and a forced tool', async () => {
    const { provider, requests, onUsage } = setup(jsonReply(toolMessage({ title: 'Привет', n: 2 })));
    const result = await provider.structured(request);

    expect(result.data).toEqual({ title: 'Привет', n: 2 });
    expect(result.usage).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5', inputTokens: 100, outputTokens: 20 });
    expect(result.usage.costUsd).toBeCloseTo((100 * 0.1 + 20 * 0.5) / 1_000_000);

    expect(requests).toHaveLength(1);
    const [sent] = requests;
    expect(sent.url).toBe('https://api.anthropic.com/v1/messages');
    expect(sent.headers).toMatchObject({
      'x-api-key': 'sk-ant-test-key-123456',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(sent.body).toMatchObject({
      model: 'claude-haiku-5-5',
      system: 'SYS',
      messages: [{ role: 'user', content: 'USER' }],
      tools: [{ name: 'Result', input_schema: jsonSchema }],
      tool_choice: { type: 'tool', name: 'Result' },
    });
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 100 }), 'extract');
  });

  it('uses the smart model for tier "smart" and an explicit model over both', async () => {
    const { provider, requests } = setup(jsonReply(toolMessage({ title: 'a', n: 1 })));
    await provider.structured({ ...request, tier: 'smart' });
    await provider.structured({ ...request, tier: 'smart', model: 'claude-opus-5-5' });
    expect((requests[0].body as { model: string }).model).toBe('claude-sonnet-5-5');
    expect((requests[1].body as { model: string }).model).toBe('claude-opus-5-5');
  });

  it('does not force the tool on models that reject forced tool use, and says so in the system prompt', async () => {
    const { provider, requests } = setup(jsonReply(toolMessage({ title: 'a', n: 1 })));
    await provider.structured({ ...request, tier: 'smart' });
    const body = requests[0].body as { tool_choice: unknown; system: string };
    expect(body.tool_choice).toEqual({ type: 'auto' });
    expect(body.system).toContain('calling the tool "Result"');
  });

  it('learns from a 400 about tool_choice and stops forcing for that model', async () => {
    const rejection = jsonReply({ type: 'error', error: { type: 'invalid_request_error', message: 'tool_choice: type "tool" is not supported for this model.' } }, 400);
    const { provider, requests } = setup(rejection, jsonReply(toolMessage({ title: 'a', n: 1 })));
    const model = 'claude-future-9';
    await provider.structured({ ...request, model });
    await provider.structured({ ...request, model });
    expect(requests.map((sent) => (sent.body as { tool_choice: { type: string } }).tool_choice.type)).toEqual(['tool', 'auto', 'auto']);
  });

  it('repairs a bad tool input exactly once and sums the usage of both requests', async () => {
    const { provider, requests, onUsage } = setup(
      jsonReply(toolMessage({ title: 5 }, { input_tokens: 100, output_tokens: 10 })),
      jsonReply(toolMessage({ title: 'ok', n: 3 }, { input_tokens: 150, output_tokens: 12 })),
    );
    const result = await provider.structured(request);
    expect(result.data).toEqual({ title: 'ok', n: 3 });
    expect(result.usage).toMatchObject({ inputTokens: 250, outputTokens: 22 });
    expect(requests).toHaveLength(2);
    const repairText = (requests[1].body as { messages: { content: string }[] }).messages[0].content;
    expect(repairText).toContain('USER');
    expect(repairText).toContain('title');
    expect(repairText).toContain('{"title":5}');
    expect(onUsage).toHaveBeenCalledTimes(2);
  });

  it('fails with BadResponseError after the single repair', async () => {
    const { provider, requests } = setup(jsonReply(toolMessage({ nope: true })));
    await expect(provider.structured(request)).rejects.toBeInstanceOf(BadResponseError);
    expect(requests).toHaveLength(2);
  });

  it('accepts JSON in text when the model ignored the tool, fences and chatter included', async () => {
    const message = { ...toolMessage({}), content: [{ type: 'text', text: 'Вот:\n```json\n{"title":"из текста","n":1,}\n```' }], stop_reason: 'end_turn' };
    const { provider } = setup(jsonReply(message));
    expect((await provider.structured(request)).data).toEqual({ title: 'из текста', n: 1 });
  });

  it('counts cached prompt tokens as input', async () => {
    const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000 };
    const { provider } = setup(jsonReply(toolMessage({ title: 'a', n: 1 }, usage)));
    expect((await provider.structured(request)).usage.inputTokens).toBe(1110);
  });

  it('turns a refusal into BadResponseError without a repair request', async () => {
    const refusal = { ...toolMessage({}), content: [], stop_reason: 'refusal' };
    const { provider, requests } = setup(jsonReply(refusal));
    await expect(provider.structured(request)).rejects.toBeInstanceOf(BadResponseError);
    expect(requests).toHaveLength(1);
  });

  it('sanitizes tool names derived from the schema name', async () => {
    const { provider, requests } = setup(jsonReply({ ...toolMessage({ title: 'a', n: 1 }), content: [{ type: 'tool_use', name: 'My_Schema__v1_', input: { title: 'a', n: 1 } }] }));
    await provider.structured({ ...request, schemaName: 'My Schema (v1)' });
    expect((requests[0].body as { tools: { name: string }[] }).tools[0].name).toBe('My_Schema__v1_');
  });
});

describe('failures', () => {
  it('throws NoKeyError before any network call', async () => {
    const { fetch, requests } = scriptedFetch(jsonReply({}));
    const provider = createAnthropicProvider({ apiKey: '  ', models: MODELS, http: testHttp(fetch) });
    await expect(provider.structured(request)).rejects.toBeInstanceOf(NoKeyError);
    await expect(provider.chat({ system: '', messages: [{ role: 'user', content: 'x' }], purpose: 'ask' })).rejects.toBeInstanceOf(NoKeyError);
    expect(requests).toHaveLength(0);
  });

  it('maps 401 to BadKeyError and keeps the key out of messages', async () => {
    const { provider } = setup(jsonReply({ type: 'error', error: { message: 'invalid x-api-key sk-ant-test-key-123456' } }, 401));
    const error = (await provider.structured(request).catch((e: unknown) => e)) as BadKeyError;
    expect(error).toBeInstanceOf(BadKeyError);
    expect(error.message).not.toContain('sk-ant');
  });

  it('retries overloaded (529) and rate-limited responses transparently', async () => {
    const { provider, requests } = setup(jsonReply({}, 529), jsonReply({}, 429, { 'retry-after': '1' }), jsonReply(toolMessage({ title: 'a', n: 1 })));
    expect((await provider.structured(request)).data).toEqual({ title: 'a', n: 1 });
    expect(requests).toHaveLength(3);
  });

  it('reports a malformed envelope as BadResponseError', async () => {
    const { provider } = setup(jsonReply({ content: 'not a list' }));
    await expect(provider.structured(request)).rejects.toBeInstanceOf(BadResponseError);
  });
});

const streamEvents = (texts: string[], tail: unknown[] = []) => [
  { event: 'message_start', data: { type: 'message_start', message: { usage: { input_tokens: 42, output_tokens: 1 } } } },
  { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
  { event: 'ping', data: { type: 'ping' } },
  ...texts.map((text) => ({ event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } })),
  ...tail.map((data) => ({ data })),
  { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 17 } } },
  { event: 'message_stop', data: { type: 'message_stop' } },
];

describe('chat', () => {
  const chatRequest = { system: 'SYS', messages: [{ role: 'user' as const, content: 'Привет' }], purpose: 'ask' as const };

  it('streams tokens in order, sends stream:true and reports usage', async () => {
    const { provider, requests, onUsage } = setup(sseReply(streamEvents(['При', 'вет, ', 'мир! 👋'])));
    const tokens: string[] = [];
    const result = await provider.chat({ ...chatRequest, onToken: (token) => tokens.push(token) });

    expect(tokens).toEqual(['При', 'вет, ', 'мир! 👋']);
    expect(result.text).toBe('Привет, мир! 👋');
    expect(result.usage).toMatchObject({ inputTokens: 42, outputTokens: 17 });
    expect(requests[0].body).toMatchObject({ stream: true, system: 'SYS', messages: [{ role: 'user', content: 'Привет' }] });
    expect(requests[0].headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ outputTokens: 17 }), 'ask');
  });

  it('ignores unknown events and tolerates keep-alive junk', async () => {
    const events = streamEvents(['ок'], [{ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'скрыто' } }]);
    events.splice(2, 0, { event: 'ping', data: 'not json at all' });
    const { provider } = setup(sseReply(events));
    expect((await provider.chat(chatRequest)).text).toBe('ок');
  });

  it('maps an in-stream overloaded error to a typed error', async () => {
    const { provider } = setup(sseReply([{ event: 'error', data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }]));
    const error = (await provider.chat(chatRequest).catch((e: unknown) => e)) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.status).toBe(529);
  });

  it('rejects an empty answer', async () => {
    const { provider } = setup(sseReply(streamEvents([])));
    await expect(provider.chat(chatRequest)).rejects.toBeInstanceOf(BadResponseError);
  });

  it('can be cancelled in the middle of the stream', async () => {
    const { provider } = setup(hangingSseReply(streamEvents(['начало']).slice(0, 4)));
    const controller = new AbortController();
    const attempt = provider.chat({ ...chatRequest, signal: controller.signal, onToken: () => controller.abort() });
    await expect(attempt).rejects.toBeInstanceOf(AbortedError);
  });
});

describe('test()', () => {
  it('reports a working connection in Russian', async () => {
    const { provider, onUsage } = setup(jsonReply({ content: [{ type: 'text', text: 'ок' }], usage: { input_tokens: 9, output_tokens: 1 } }));
    const result = await provider.test();
    expect(result).toEqual({ ok: true, message: 'Соединение работает. Модель: claude-haiku-5-5.' });
    expect(onUsage).toHaveBeenCalledWith(expect.anything(), 'test');
  });

  it('reports a rejected key without throwing', async () => {
    const { provider } = setup(jsonReply({ error: { message: 'bad' } }, 401));
    const result = await provider.test();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('ключ');
  });
});
