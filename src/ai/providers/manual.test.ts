import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AbortedError } from '../errors';
import { createManualBridge, createManualProvider, manualBridge, sharedManualProvider } from './manual';

const Out = z.object({ title: z.string(), n: z.number() });
const jsonSchema = { type: 'object', properties: { title: { type: 'string' }, n: { type: 'number' } } };
const request = { system: 'СИСТЕМА', user: 'ДАННЫЕ ЗАПИСИ', schemaName: 'Out', jsonSchema, zod: Out, purpose: 'extract' as const };

function setup() {
  const hub = createManualBridge();
  return { provider: createManualProvider(hub), bridge: hub.bridge };
}

describe('structured via clipboard', () => {
  it('turns the request into a ready prompt and waits for the pasted JSON', async () => {
    const { provider, bridge } = setup();
    const listener = vi.fn();
    bridge.subscribe(listener);

    let settled = false;
    const promise = provider.structured(request).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();

    const prompt = bridge.getPendingPrompt() ?? '';
    expect(prompt).toContain('СИСТЕМА');
    expect(prompt).toContain('ДАННЫЕ ЗАПИСИ');
    expect(prompt).toContain('JSON Schema');
    expect(prompt).toContain('"title"');
    expect(bridge.getPending()).toMatchObject({ kind: 'structured', purpose: 'extract' });
    expect(settled).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    expect(bridge.submitResponse('Вот ответ:\n```json\n{"title": "из чата", "n": 3,}\n```')).toEqual({ ok: true });
    const result = await promise;
    expect(result.data).toEqual({ title: 'из чата', n: 3 });
    expect(result.usage).toMatchObject({ provider: 'manual', model: 'clipboard' });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(bridge.getPending()).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('keeps waiting after a bad paste, explains the problem and offers a repair prompt', async () => {
    const { provider, bridge } = setup();
    const promise = provider.structured(request);

    const bad = bridge.submitResponse('{"title": 5}');
    expect(bad.ok).toBe(false);
    expect(bridge.getPending()?.lastError).toContain('Не удалось разобрать ответ');
    expect(bridge.getPending()?.repairPrompt).toContain('{"title": 5}');
    expect(bridge.getPending()?.repairPrompt).toContain('ДАННЫЕ ЗАПИСИ');

    expect(bridge.submitResponse('просто слова').ok).toBe(false);
    expect(bridge.submitResponse('   ')).toEqual({ ok: false, error: expect.stringContaining('ничего не вставили') });

    expect(bridge.submitResponse('{"title": "ок", "n": 1}')).toEqual({ ok: true });
    await expect(promise).resolves.toMatchObject({ data: { title: 'ок', n: 1 } });
  });

  it('rejects a submit when nothing is waiting', () => {
    const { bridge } = setup();
    expect(bridge.submitResponse('{}')).toEqual({ ok: false, error: expect.stringContaining('нечего вставлять') });
  });

  it('serves requests in order', async () => {
    const { provider, bridge } = setup();
    const first = provider.structured({ ...request, user: 'ПЕРВЫЙ' });
    const second = provider.structured({ ...request, user: 'ВТОРОЙ' });
    expect(bridge.getPendingPrompt()).toContain('ПЕРВЫЙ');
    bridge.submitResponse('{"title":"1","n":1}');
    expect(bridge.getPendingPrompt()).toContain('ВТОРОЙ');
    bridge.submitResponse('{"title":"2","n":2}');
    expect((await first).data.title).toBe('1');
    expect((await second).data.title).toBe('2');
  });
});

describe('cancellation', () => {
  it('rejects with AbortedError when the signal fires and moves on to the next request', async () => {
    const { provider, bridge } = setup();
    const controller = new AbortController();
    const first = provider.structured({ ...request, user: 'ПЕРВЫЙ', signal: controller.signal });
    const second = provider.structured({ ...request, user: 'ВТОРОЙ' });
    controller.abort();
    await expect(first).rejects.toBeInstanceOf(AbortedError);
    expect(bridge.getPendingPrompt()).toContain('ВТОРОЙ');
    bridge.submitResponse('{"title":"x","n":1}');
    await second;
  });

  it('rejects immediately for a signal that is already aborted', async () => {
    const { provider, bridge } = setup();
    const controller = new AbortController();
    controller.abort();
    await expect(provider.structured({ ...request, signal: controller.signal })).rejects.toBeInstanceOf(AbortedError);
    expect(bridge.getPending()).toBeUndefined();
  });

  it('cancelPending lets the user give up', async () => {
    const { provider, bridge } = setup();
    const promise = provider.structured(request);
    bridge.cancelPending();
    await expect(promise).rejects.toBeInstanceOf(AbortedError);
    expect(bridge.getPending()).toBeUndefined();
    expect(() => bridge.cancelPending()).not.toThrow();
  });
});

describe('chat and test', () => {
  it('builds a dialogue prompt and resolves with the pasted text', async () => {
    const { provider, bridge } = setup();
    const onToken = vi.fn();
    const promise = provider.chat({
      system: 'Отвечай по данным',
      messages: [
        { role: 'user', content: 'Что я обещал?' },
        { role: 'assistant', content: 'Уточните период.' },
        { role: 'user', content: 'За неделю' },
      ],
      purpose: 'ask',
      onToken,
    });
    const prompt = bridge.getPendingPrompt() ?? '';
    expect(prompt).toContain('Пользователь: Что я обещал?');
    expect(prompt).toContain('Ассистент: Уточните период.');
    expect(bridge.getPending()?.kind).toBe('chat');

    bridge.submitResponse('Вы обещали позвонить Маше [i1].');
    await expect(promise).resolves.toMatchObject({ text: 'Вы обещали позвонить Маше [i1].' });
    expect(onToken).toHaveBeenCalledWith('Вы обещали позвонить Маше [i1].');
  });

  it('test() always works offline', async () => {
    expect(await setup().provider.test()).toMatchObject({ ok: true });
  });

  it('the shared provider and shared bridge are connected', async () => {
    const promise = sharedManualProvider.structured(request);
    expect(manualBridge.getPendingPrompt()).toContain('ДАННЫЕ ЗАПИСИ');
    manualBridge.submitResponse('{"title":"s","n":0}');
    await expect(promise).resolves.toMatchObject({ data: { title: 's' } });
  });
});
