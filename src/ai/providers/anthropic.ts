import { z } from 'zod';
import type { AiModels } from '../../domain/types';
import { AiError, BadKeyError, BadResponseError, ProviderError, RateLimitError } from '../errors';
import { redact, requestJson, requestStream } from '../http';
import type { HttpConfig } from '../http';
import { runStructured, buildRepairUser } from '../json';
import type { RawReply } from '../json';
import { readSse } from '../sse';
import { recall, remember } from './capabilities';
import {
  DEFAULT_CHAT_MAX_TOKENS,
  DEFAULT_STRUCTURED_MAX_TOKENS,
  asRecord,
  makeUsage,
  pickModel,
  reportUsage,
  requireKey,
  tokenCount,
} from './shared';
import type { ProviderHooks } from './shared';
import type { ChatRequest, ChatResult, LlmProvider, StructuredRequest, StructuredResult } from './types';
import { t } from '../../i18n';

/**
 * Anthropic Messages API called straight from the browser (the user's own key).
 * Structured output goes through a tool; chat streams over SSE.
 */

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com';
export const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Models that answer 400 to `tool_choice: {type: 'tool'}` (forced tool use is removed from them).
 * Other models are tried with it first; a 400 about `tool_choice` is remembered per model.
 */
const FORCED_TOOL_REJECTED = /sonnet-5-5|opus-5-5|fable-5-1|mythos-5-1/;

export interface AnthropicProviderConfig extends ProviderHooks {
  apiKey: string;
  models: AiModels;
  baseUrl?: string;
  http?: HttpConfig;
}

const ResponseSchema = z.looseObject({
  content: z
    .array(
      z.looseObject({
        type: z.string(),
        name: z.string().optional(),
        text: z.string().optional(),
        input: z.unknown().optional(),
      }),
    )
    .default([]),
  stop_reason: z.string().nullish(),
  usage: z
    .looseObject({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().nullish(),
      cache_read_input_tokens: z.number().nullish(),
    })
    .optional(),
});

interface ParsedMessage {
  toolInput?: unknown;
  text: string;
  stopReason?: string;
  inputTokens: number;
  outputTokens: number;
}

/** Cached prompt tokens are input too: they are billed (at a discount) and shown as usage. */
function inputTokensOf(usage: Record<string, unknown> | undefined): number {
  return tokenCount(usage?.input_tokens) + tokenCount(usage?.cache_creation_input_tokens) + tokenCount(usage?.cache_read_input_tokens);
}

function parseMessage(json: unknown, toolName?: string): ParsedMessage {
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) throw new BadResponseError(t('Unexpected Anthropic response: {v}', { v: parsed.error.issues[0]?.message ?? t('wrong shape') }));
  const { content, stop_reason: stopReason, usage } = parsed.data;
  const tool = content.find((block) => block.type === 'tool_use' && (toolName === undefined || block.name === toolName));
  const text = content
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');
  return {
    ...(tool && { toolInput: tool.input }),
    text,
    ...(stopReason && { stopReason }),
    inputTokens: inputTokensOf(usage),
    outputTokens: tokenCount(usage?.output_tokens),
  };
}

/** Tool names are limited to `[a-zA-Z0-9_-]{1,64}`. */
function toolNameOf(schemaName: string): string {
  const cleaned = schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return cleaned === '' ? 'result' : cleaned;
}

function errorFromStreamEvent(error: Record<string, unknown> | undefined): AiError {
  const type = typeof error?.type === 'string' ? error.type : '';
  const message = typeof error?.message === 'string' ? redact(error.message.slice(0, 300)) : undefined;
  if (type === 'authentication_error' || type === 'permission_error') return new BadKeyError();
  if (type === 'rate_limit_error') return new RateLimitError();
  if (type === 'overloaded_error') return new ProviderError(529, message ?? t('the provider is overloaded'));
  return new ProviderError(500, message);
}

function isForcedToolRejection(error: unknown): boolean {
  return error instanceof ProviderError && error.status === 400 && /tool_choice/i.test(error.providerMessage ?? '');
}

export function createAnthropicProvider(config: AnthropicProviderConfig): LlmProvider {
  const baseUrl = (config.baseUrl ?? ANTHROPIC_BASE_URL).replace(/\/+$/, '');
  const url = `${baseUrl}/v1/messages`;
  const http: HttpConfig = { ...config.http, secrets: [...(config.http?.secrets ?? []), config.apiKey] };
  const forcedKey = (model: string) => `anthropic|${baseUrl}|${model}|forced-tool-rejected`;

  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    'x-api-key': requireKey(config.apiKey),
    'anthropic-version': ANTHROPIC_VERSION,
    // Without this header the browser is not allowed to call the API directly (CORS).
    'anthropic-dangerous-direct-browser-access': 'true',
  });

  async function structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const model = pickModel(request, config.models);
    const toolName = toolNameOf(request.schemaName);
    const tool = {
      name: toolName,
      description: `Return the result. Pass the complete answer as the input of this tool (${request.schemaName}).`,
      input_schema: request.jsonSchema,
    };

    const send = async (userText: string, forced: boolean): Promise<ParsedMessage> => {
      const body = {
        model,
        max_tokens: request.maxTokens ?? DEFAULT_STRUCTURED_MAX_TOKENS,
        system: forced ? request.system : `${request.system}\n\nReturn the result by calling the tool "${toolName}" exactly once.`,
        messages: [{ role: 'user', content: userText }],
        tools: [tool],
        tool_choice: forced ? { type: 'tool', name: toolName } : { type: 'auto' },
      };
      const message = parseMessage(
        await requestJson(url, { headers: headers(), body: JSON.stringify(body), signal: request.signal }, http),
        toolName,
      );
      await reportUsage(config.onUsage, makeUsage('anthropic', model, message.inputTokens, message.outputTokens), request.purpose);
      if (message.stopReason === 'refusal') throw new BadResponseError(t('The model refused to answer (refusal)'));
      return message;
    };

    const call = async (userText: string): Promise<ParsedMessage> => {
      if (recall<boolean>(forcedKey(model)) || FORCED_TOOL_REJECTED.test(model)) return send(userText, false);
      try {
        return await send(userText, true);
      } catch (error) {
        if (!isForcedToolRejection(error)) throw error;
        remember(forcedKey(model), true);
        return send(userText, false);
      }
    };

    const run = await runStructured(request.zod, async (repair): Promise<RawReply> => {
      const message = await call(repair ? buildRepairUser(request.user, repair) : request.user);
      return {
        ...(message.toolInput !== undefined && { value: message.toolInput }),
        text: message.text,
        inputTokens: message.inputTokens,
        outputTokens: message.outputTokens,
        truncated: message.stopReason === 'max_tokens',
      };
    });
    return { data: run.data, usage: makeUsage('anthropic', model, run.inputTokens, run.outputTokens) };
  }

  async function chat(request: ChatRequest): Promise<ChatResult> {
    const model = pickModel(request, config.models);
    const body = {
      model,
      max_tokens: request.maxTokens ?? DEFAULT_CHAT_MAX_TOKENS,
      system: request.system,
      messages: request.messages,
      stream: true,
    };
    const response = await requestStream(url, { headers: headers(), body: JSON.stringify(body), signal: request.signal }, http);

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    // `response.body` is non-null: requestStream rejects responses without a body.
    for await (const event of readSse(response.body as ReadableStream<Uint8Array>, { signal: request.signal })) {
      let payload: Record<string, unknown> | undefined;
      try {
        payload = asRecord(JSON.parse(event.data));
      } catch {
        continue;
      }
      switch (payload?.type) {
        case 'message_start':
          inputTokens = inputTokensOf(asRecord(asRecord(payload.message)?.usage));
          outputTokens = tokenCount(asRecord(asRecord(payload.message)?.usage)?.output_tokens);
          break;
        case 'content_block_delta': {
          const delta = asRecord(payload.delta);
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            text += delta.text;
            request.onToken?.(delta.text);
          }
          break;
        }
        case 'message_delta': {
          const usage = asRecord(payload.usage);
          // `output_tokens` is cumulative; input counts may be restated here as well.
          outputTokens = tokenCount(usage?.output_tokens) || outputTokens;
          inputTokens = inputTokensOf(usage) || inputTokens;
          break;
        }
        case 'error':
          throw errorFromStreamEvent(asRecord(payload.error));
        default:
          break;
      }
    }

    const usage = makeUsage('anthropic', model, inputTokens, outputTokens);
    await reportUsage(config.onUsage, usage, request.purpose);
    if (text.trim() === '') throw new BadResponseError(t('The model returned an empty answer'));
    return { text, usage };
  }

  async function test(): Promise<{ ok: boolean; message: string }> {
    const model = config.models.fast;
    try {
      const body = { model, max_tokens: 64, messages: [{ role: 'user', content: t('Answer with one word: ok') }] };
      const message = parseMessage(await requestJson(url, { headers: headers(), body: JSON.stringify(body) }, http));
      await reportUsage(config.onUsage, makeUsage('anthropic', model, message.inputTokens, message.outputTokens), 'test');
      return { ok: true, message: t('Connection works. Model: {model}.', { model }) };
    } catch (error) {
      return { ok: false, message: error instanceof AiError ? error.message : t('Could not check the connection.') };
    }
  }

  return { id: 'anthropic', structured, chat, test };
}
