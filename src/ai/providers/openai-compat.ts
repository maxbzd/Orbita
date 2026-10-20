import { z } from 'zod';
import { estimateTokens } from '../../domain/tokens';
import type { AiModels } from '../../domain/types';
import { AiError, BadResponseError, NoKeyError, ProviderError } from '../errors';
import { redact, requestJson, requestStream } from '../http';
import type { HttpConfig } from '../http';
import { buildRepairUser, runStructured } from '../json';
import type { RawReply } from '../json';
import { readSse } from '../sse';
import { recall, remember } from './capabilities';
import {
  DEFAULT_CHAT_MAX_TOKENS,
  DEFAULT_STRUCTURED_MAX_TOKENS,
  asRecord,
  isLocalAddress,
  makeUsage,
  normalizeBaseUrl,
  pickModel,
  reportUsage,
  tokenCount,
} from './shared';
import type { ProviderHooks } from './shared';
import type { ChatRequest, ChatResult, LlmProvider, StructuredRequest, StructuredResult } from './types';
import { t } from '../../i18n';

/**
 * Any server speaking the OpenAI Chat Completions protocol (OpenAI, Groq, OpenRouter, a local Ollama…).
 * Servers differ in what they accept, so the provider adapts: structured output starts with strict
 * `json_schema`, falls back to `json_object` and finally to a plain prompt; token limits are sent as
 * `max_tokens` or `max_completion_tokens` depending on what the endpoint answers.
 */

export interface OpenAiCompatConfig extends ProviderHooks {
  apiKey: string;
  baseUrl: string;
  models: AiModels;
  http?: HttpConfig;
}

type OutputMode = 'json_schema' | 'json_object' | 'prompt';
const OUTPUT_MODES: readonly OutputMode[] = ['json_schema', 'json_object', 'prompt'];

interface Flags {
  mode: OutputMode;
  /** Send `max_completion_tokens` instead of `max_tokens`. */
  completionTokens: boolean;
  /** Ask the stream to include a usage chunk. */
  streamUsage: boolean;
}

const DEFAULT_FLAGS: Flags = { mode: 'json_schema', completionTokens: false, streamUsage: true };
const MAX_ADAPTATIONS = 4;

const ChoiceSchema = z.looseObject({
  message: z
    .looseObject({
      content: z.union([z.string(), z.array(z.looseObject({ type: z.string().optional(), text: z.string().optional() })), z.null()]).optional(),
      refusal: z.string().nullish(),
    })
    .optional(),
  finish_reason: z.string().nullish(),
});

const CompletionSchema = z.looseObject({
  choices: z.array(ChoiceSchema).default([]),
  usage: z.looseObject({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).nullish(),
});

interface ParsedCompletion {
  text: string;
  finishReason?: string;
  inputTokens: number;
  outputTokens: number;
}

function parseCompletion(json: unknown): ParsedCompletion {
  const parsed = CompletionSchema.safeParse(json);
  if (!parsed.success) throw new BadResponseError(t('Unexpected server response: {v}', { v: parsed.error.issues[0]?.message ?? t('wrong shape') }));
  const choice = parsed.data.choices[0];
  if (!choice) throw new BadResponseError(t('The server response has no choices'));
  if (choice.message?.refusal) throw new BadResponseError(t('The model refused to answer: {v}', { v: choice.message.refusal.slice(0, 200) }));
  const content = choice.message?.content;
  const text = Array.isArray(content) ? content.map((part) => part.text ?? '').join('') : (content ?? '');
  return {
    text,
    ...(choice.finish_reason && { finishReason: choice.finish_reason }),
    inputTokens: tokenCount(parsed.data.usage?.prompt_tokens),
    outputTokens: tokenCount(parsed.data.usage?.completion_tokens),
  };
}

function schemaName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return cleaned === '' ? 'result' : cleaned;
}

/** The instruction used when the server cannot enforce a schema itself. */
function schemaInstruction(jsonSchema: object): string {
  return [
    'Respond with a single JSON object and nothing else: no prose, no code fences.',
    'The object must match this JSON Schema (null for values that do not apply):',
    JSON.stringify(jsonSchema),
  ].join('\n');
}

/** Changes the flags in response to a 400 that names the offending parameter; undefined = not a known lesson. */
function adapt(flags: Flags, error: unknown, forStructured: boolean): Flags | undefined {
  if (!(error instanceof ProviderError) || (error.status !== 400 && error.status !== 422)) return undefined;
  const message = error.providerMessage ?? '';
  if (/max_completion_tokens/i.test(message)) return { ...flags, completionTokens: !flags.completionTokens };
  if (/stream_options|include_usage/i.test(message) && flags.streamUsage) return { ...flags, streamUsage: false };
  if (forStructured && /response_format|json_schema|json_object|structured|schema/i.test(message)) {
    const next = OUTPUT_MODES[OUTPUT_MODES.indexOf(flags.mode) + 1];
    if (next) return { ...flags, mode: next };
  }
  return undefined;
}

export function createOpenAiCompatProvider(config: OpenAiCompatConfig): LlmProvider {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const url = `${baseUrl}/chat/completions`;
  const http: HttpConfig = { ...config.http, secrets: [...(config.http?.secrets ?? []), config.apiKey] };

  const headers = (): Record<string, string> => {
    const key = config.apiKey.trim();
    if (key === '' && !isLocalAddress(baseUrl)) throw new NoKeyError();
    return { 'content-type': 'application/json', ...(key !== '' && { authorization: `Bearer ${key}` }) };
  };

  const flagsKey = (model: string) => `openai-compat|${baseUrl}|${model}|flags`;

  /** Runs `attempt` with the flags learned for this endpoint, adjusting them after each recognized rejection. */
  async function withAdaptation<T>(model: string, forStructured: boolean, attempt: (flags: Flags) => Promise<T>): Promise<T> {
    let flags = recall<Flags>(flagsKey(model)) ?? DEFAULT_FLAGS;
    for (let tries = 0; ; tries++) {
      try {
        return await attempt(flags);
      } catch (error) {
        const next = tries < MAX_ADAPTATIONS ? adapt(flags, error, forStructured) : undefined;
        if (!next) throw error;
        flags = next;
        remember(flagsKey(model), flags);
      }
    }
  }

  const limitField = (flags: Flags, maxTokens: number) =>
    flags.completionTokens ? { max_completion_tokens: maxTokens } : { max_tokens: maxTokens };

  async function structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const model = pickModel(request, config.models);
    const name = schemaName(request.schemaName);
    const maxTokens = request.maxTokens ?? DEFAULT_STRUCTURED_MAX_TOKENS;

    const send = (userText: string): Promise<ParsedCompletion> =>
      withAdaptation(model, true, async (flags) => {
        const system = flags.mode === 'json_schema' ? request.system : `${request.system}\n\n${schemaInstruction(request.jsonSchema)}`;
        const body = {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userText },
          ],
          ...limitField(flags, maxTokens),
          ...(flags.mode === 'json_schema' && {
            response_format: { type: 'json_schema', json_schema: { name, schema: request.jsonSchema, strict: true } },
          }),
          ...(flags.mode === 'json_object' && { response_format: { type: 'json_object' } }),
        };
        const completion = parseCompletion(
          await requestJson(url, { headers: headers(), body: JSON.stringify(body), signal: request.signal }, http),
        );
        await reportUsage(config.onUsage, makeUsage('openai-compat', model, completion.inputTokens, completion.outputTokens), request.purpose);
        return completion;
      });

    const run = await runStructured(request.zod, async (repair): Promise<RawReply> => {
      const completion = await send(repair ? buildRepairUser(request.user, repair) : request.user);
      return {
        text: completion.text,
        inputTokens: completion.inputTokens,
        outputTokens: completion.outputTokens,
        truncated: completion.finishReason === 'length',
      };
    });
    return { data: run.data, usage: makeUsage('openai-compat', model, run.inputTokens, run.outputTokens) };
  }

  async function chat(request: ChatRequest): Promise<ChatResult> {
    const model = pickModel(request, config.models);
    const maxTokens = request.maxTokens ?? DEFAULT_CHAT_MAX_TOKENS;
    const messages: { role: string; content: string }[] = [{ role: 'system', content: request.system }, ...request.messages];

    const response = await withAdaptation(model, false, (flags) => {
      const body = {
        model,
        messages,
        ...limitField(flags, maxTokens),
        stream: true,
        ...(flags.streamUsage && { stream_options: { include_usage: true } }),
      };
      return requestStream(url, { headers: headers(), body: JSON.stringify(body), signal: request.signal }, http);
    });

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    // `response.body` is non-null: requestStream rejects responses without a body.
    for await (const event of readSse(response.body as ReadableStream<Uint8Array>, { signal: request.signal })) {
      if (event.data === '[DONE]') break;
      let chunk: Record<string, unknown> | undefined;
      try {
        chunk = asRecord(JSON.parse(event.data));
      } catch {
        continue;
      }
      const failure = asRecord(chunk?.error);
      if (failure) throw new ProviderError(500, typeof failure.message === 'string' ? redact(failure.message.slice(0, 300)) : undefined);

      const usage = asRecord(chunk?.usage);
      if (usage) {
        inputTokens = tokenCount(usage.prompt_tokens) || inputTokens;
        outputTokens = tokenCount(usage.completion_tokens) || outputTokens;
      }
      const choices = chunk?.choices;
      const delta = Array.isArray(choices) ? asRecord(asRecord(choices[0])?.delta) : undefined;
      if (typeof delta?.content === 'string' && delta.content !== '') {
        text += delta.content;
        request.onToken?.(delta.content);
      }
    }

    // Some servers never send the usage chunk: an estimate is better than a zero in the counter.
    if (inputTokens === 0 && outputTokens === 0) {
      inputTokens = estimateTokens(messages.map((message) => message.content).join('\n'));
      outputTokens = estimateTokens(text);
    }
    const usage = makeUsage('openai-compat', model, inputTokens, outputTokens);
    await reportUsage(config.onUsage, usage, request.purpose);
    if (text.trim() === '') throw new BadResponseError(t('The model returned an empty answer'));
    return { text, usage };
  }

  async function test(): Promise<{ ok: boolean; message: string }> {
    const model = config.models.fast;
    try {
      const completion = await withAdaptation(model, false, async (flags) => {
        const body = { model, messages: [{ role: 'user', content: t('Answer with one word: ok') }], ...limitField(flags, 16) };
        return parseCompletion(await requestJson(url, { headers: headers(), body: JSON.stringify(body) }, http));
      });
      await reportUsage(config.onUsage, makeUsage('openai-compat', model, completion.inputTokens, completion.outputTokens), 'test');
      return { ok: true, message: t('Connection works. Model: {model}.', { model }) };
    } catch (error) {
      return { ok: false, message: error instanceof AiError ? error.message : t('Could not check the connection.') };
    }
  }

  return { id: 'openai-compat', structured, chat, test };
}
