import { afterEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from './emitter';

class Speaker extends Emitter<{ word: string; bang: number }> {
  say(word: string): void {
    this.emit('word', word);
  }
}

afterEach(() => vi.restoreAllMocks());

describe('Emitter', () => {
  it('delivers events to every subscriber of that event, in order', () => {
    const speaker = new Speaker();
    const seen: string[] = [];
    speaker.on('word', (word) => seen.push(`a:${word}`));
    speaker.on('word', (word) => seen.push(`b:${word}`));
    speaker.on('bang', () => seen.push('bang'));
    speaker.say('hi');
    expect(seen).toEqual(['a:hi', 'b:hi']);
  });

  it('stops delivering to an unsubscribed handler, even from inside another handler', () => {
    const speaker = new Speaker();
    const seen: string[] = [];
    const off = speaker.on('word', (word) => seen.push(word));
    speaker.say('one');
    off();
    speaker.say('two');
    expect(seen).toEqual(['one']);
  });

  it('survives a handler that throws: the rest still run and the error is rethrown later', () => {
    const queued: (() => void)[] = [];
    vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      queued.push(callback);
    });
    const speaker = new Speaker();
    const seen: string[] = [];
    speaker.on('word', () => {
      throw new Error('buggy subscriber');
    });
    speaker.on('word', (word) => seen.push(word));

    expect(() => speaker.say('hi')).not.toThrow();

    expect(seen).toEqual(['hi']);
    expect(queued).toHaveLength(1);
    expect(() => queued[0]!()).toThrow('buggy subscriber');
  });
});
