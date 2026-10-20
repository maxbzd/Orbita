import type { FetchLike, HttpConfig } from './http';

/** Helpers for tests of the AI layer: a scripted `fetch` and canned responses. The network is never touched. */

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Parsed JSON body (or the raw string / FormData when it is not JSON). */
  body: unknown;
  signal?: AbortSignal | null;
}

export type Reply = Response | Error | ((request: RecordedRequest) => Response | Promise<Response>);

function readBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

/** Answers requests with `replies` in order (the last one repeats); every request is recorded. */
export function scriptedFetch(...replies: Reply[]): { fetch: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetch: FetchLike = async (url, init) => {
    const request: RecordedRequest = {
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string> | undefined) ?? {})),
      body: readBody(init?.body),
      signal: init?.signal,
    };
    requests.push(request);
    const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
    if (reply === undefined) throw new Error('scriptedFetch: no replies configured');
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(request) : reply.clone();
  };
  return { fetch, requests };
}

/** Test HTTP configuration: no real waiting between retries. */
export function testHttp(fetch: FetchLike, overrides: Partial<HttpConfig> = {}): HttpConfig {
  return { fetch, sleep: async () => undefined, random: () => 0, ...overrides };
}

export function jsonReply(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

export function textReply(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

export interface SseItem {
  event?: string;
  /** Objects are serialized to JSON; strings are sent as they are. */
  data: unknown;
}

/** An SSE response delivered in small pieces, so that parsers meet events split across chunks. */
export function sseReply(items: readonly SseItem[], chunkSize = 7): Response {
  const text = items
    .map((item) => `${item.event ? `event: ${item.event}\n` : ''}data: ${typeof item.data === 'string' ? item.data : JSON.stringify(item.data)}\n\n`)
    .join('');
  const bytes = new TextEncoder().encode(text);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) controller.enqueue(bytes.slice(offset, offset + chunkSize));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

/** A stream that sends `items`, then stays open forever (until cancelled): for cancellation tests. */
export function hangingSseReply(items: readonly SseItem[]): Response {
  const text = items.map((item) => `data: ${typeof item.data === 'string' ? item.data : JSON.stringify(item.data)}\n\n`).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
