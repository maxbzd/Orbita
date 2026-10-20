import { AbortedError, BadResponseError, TimeoutError } from './errors';
import { t } from '../i18n';

/** Server-sent events: a tolerant parser and a reader that enforces an idle timeout and cancellation. */

export interface SseEvent {
  /** Value of the `event:` field, if any. */
  event?: string;
  /** All `data:` lines joined with `\n`. */
  data: string;
}

/** Incremental parser: feed it text pieces in any split, it returns the events completed so far. */
export class SseParser {
  private buffer = '';
  private event: string | undefined;
  private data: string[] = [];

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let newline: number;
    while ((newline = this.buffer.search(/\r\n|\n|\r/)) !== -1) {
      const terminator = this.buffer.startsWith('\r\n', newline) ? 2 : 1;
      // A lone "\r" at the very end may be the first half of "\r\n": wait for more input.
      if (this.buffer[newline] === '\r' && newline + 1 === this.buffer.length) break;
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + terminator);
      const finished = this.line(line);
      if (finished) events.push(finished);
    }
    return events;
  }

  /** Flushes an event that was not followed by a blank line (the stream ended abruptly). */
  end(): SseEvent[] {
    const events: SseEvent[] = [];
    if (this.buffer !== '') {
      const finished = this.line(this.buffer);
      this.buffer = '';
      if (finished) events.push(finished);
    }
    const last = this.dispatch();
    if (last) events.push(last);
    return events;
  }

  private line(line: string): SseEvent | undefined {
    if (line === '') return this.dispatch();
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
    return undefined;
  }

  private dispatch(): SseEvent | undefined {
    if (this.data.length === 0) {
      this.event = undefined;
      return undefined;
    }
    const event: SseEvent = { data: this.data.join('\n') };
    if (this.event !== undefined) event.event = this.event;
    this.event = undefined;
    this.data = [];
    return event;
  }
}

export interface ReadSseOptions {
  signal?: AbortSignal;
  /** Maximum silence between two chunks of the body. */
  idleTimeoutMs?: number;
}

export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(idleTimeoutMs / 1000)), idleTimeoutMs);
    reader.read().then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Events of an SSE response body, in order. Throws typed errors on cancellation, silence and broken streams. */
export async function* readSse(body: ReadableStream<Uint8Array>, options: ReadSseOptions = {}): AsyncGenerator<SseEvent> {
  const { signal, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS } = options;
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parser = new SseParser();

  try {
    for (;;) {
      if (signal?.aborted) throw new AbortedError();
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await readWithTimeout(reader, idleTimeoutMs);
      } catch (error) {
        if (signal?.aborted) throw new AbortedError();
        if (error instanceof TimeoutError || error instanceof AbortedError) throw error;
        if (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError') throw new AbortedError();
        throw new BadResponseError(t('The response stream broke off: {v}', { v: error instanceof Error ? error.message : String(error) }));
      }
      if (result.done) break;
      yield* parser.push(decoder.decode(result.value, { stream: true }));
    }
    yield* parser.push(decoder.decode());
    yield* parser.end();
  } finally {
    // Cancelling also tells the server to stop generating when the consumer gave up early.
    reader.cancel().catch(() => undefined);
  }
}
