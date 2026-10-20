import { describe, expect, it } from 'vitest';
import { AbortedError, BadResponseError, TimeoutError } from './errors';
import { SseParser, readSse } from './sse';

const encoder = new TextEncoder();

function streamOf(...chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>, signal?: AbortSignal) {
  const events = [];
  for await (const event of readSse(stream, { signal })) events.push(event);
  return events;
}

describe('SseParser', () => {
  it('parses events with names, multi-line data and comments', () => {
    const parser = new SseParser();
    const events = parser.push(': keep-alive\n\nevent: delta\ndata: {"a":1}\n\ndata: one\ndata: two\n\n');
    expect(events).toEqual([{ event: 'delta', data: '{"a":1}' }, { data: 'one\ntwo' }]);
  });

  it('copes with any split of the input, including CRLF cut in the middle', () => {
    const text = 'event: a\r\ndata: 1\r\n\r\ndata: 2\n\n';
    for (let cut = 1; cut < text.length; cut++) {
      const parser = new SseParser();
      const events = [...parser.push(text.slice(0, cut)), ...parser.push(text.slice(cut)), ...parser.end()];
      expect(events, `cut at ${cut}`).toEqual([{ event: 'a', data: '1' }, { data: '2' }]);
    }
  });

  it('flushes a final event that lacks the closing blank line', () => {
    const parser = new SseParser();
    expect(parser.push('data: tail')).toEqual([]);
    expect(parser.end()).toEqual([{ data: 'tail' }]);
  });

  it('ignores events without data and keeps an empty data line', () => {
    const parser = new SseParser();
    expect(parser.push('event: ping\n\ndata:\n\n')).toEqual([{ data: '' }]);
  });
});

describe('readSse', () => {
  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = encoder.encode('data: Привет\n\n');
    const events = await collect(streamOf(bytes.slice(0, 8), bytes.slice(8)));
    expect(events).toEqual([{ data: 'Привет' }]);
  });

  it('throws AbortedError when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(collect(streamOf('data: x\n\n'), controller.signal)).rejects.toBeInstanceOf(AbortedError);
  });

  it('times out when the server goes silent', async () => {
    const silent = new ReadableStream<Uint8Array>({ start() {} });
    const run = async () => {
      for await (const event of readSse(silent, { idleTimeoutMs: 20 })) void event;
    };
    await expect(run()).rejects.toBeInstanceOf(TimeoutError);
  });

  it('turns a broken body into BadResponseError', async () => {
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    await expect(collect(broken)).rejects.toBeInstanceOf(BadResponseError);
  });
});
