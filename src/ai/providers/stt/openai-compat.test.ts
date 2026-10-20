import { describe, expect, it, vi } from 'vitest';
import { BadKeyError, BadResponseError, NoKeyError, ProviderError } from '../../errors';
import { jsonReply, scriptedFetch, testHttp } from '../../testing';
import type { SttUsage } from '../types';
import { MAX_AUDIO_BYTES, audioFileName, buildMultipart, createOpenAiCompatStt, isoLanguage } from './openai-compat';

const audio = (size = 2048, type = 'audio/webm;codecs=opus') => new Blob([new Uint8Array(size).fill(7)], { type });

function setup(reply: Parameters<typeof scriptedFetch>[0], overrides: Partial<Parameters<typeof createOpenAiCompatStt>[0]> = {}) {
  const { fetch, requests } = scriptedFetch(reply);
  const onUsage = vi.fn<(usage: SttUsage) => void>();
  const stt = createOpenAiCompatStt({
    apiKey: 'sk-stt-key-0123456789',
    baseUrl: 'https://api.example.test/v1/',
    model: 'whisper-1',
    http: testHttp(fetch),
    onUsage,
    ...overrides,
  });
  return { stt, requests, onUsage };
}

describe('helpers', () => {
  it('picks the file name by MIME type, ignoring codec parameters', () => {
    expect(audioFileName('audio/webm;codecs=opus')).toBe('audio.webm');
    expect(audioFileName('audio/mp4')).toBe('audio.mp4');
    expect(audioFileName('audio/x-wav')).toBe('audio.wav');
    expect(audioFileName('audio/aac')).toBe('audio.aac');
    expect(audioFileName('')).toBe('audio.webm');
  });

  it('reduces a locale to a two-letter language', () => {
    expect(isoLanguage('ru-RU')).toBe('ru');
    expect(isoLanguage(' EN_us ')).toBe('en');
  });

  it('builds a multipart body that carries fields and the binary file intact', async () => {
    const { body, contentType } = buildMultipart({ model: 'm', prompt: 'OKR, KPI' }, { field: 'file', filename: 'audio.webm', blob: audio(4, 'audio/webm'), mime: 'audio/webm' }, 'BOUND');
    expect(contentType).toBe('multipart/form-data; boundary=BOUND');
    const bytes = new Uint8Array(await body.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('--BOUND\r\nContent-Disposition: form-data; name="model"\r\n\r\nm\r\n');
    expect(text).toContain('name="prompt"\r\n\r\nOKR, KPI\r\n');
    expect(text).toContain('name="file"; filename="audio.webm"\r\nContent-Type: audio/webm\r\n\r\n');
    expect(text.endsWith('\r\n--BOUND--\r\n')).toBe(true);
    expect(text).toContain(String.fromCharCode(7).repeat(4));
  });
});

describe('transcribe', () => {
  it('posts the recording to /audio/transcriptions with language, glossary prompt and key', async () => {
    const { stt, requests, onUsage } = setup(jsonReply({ text: '  Привет, мир  ', duration: 12.5 }));
    const result = await stt.transcribe(audio(), { lang: 'ru-RU', prompt: 'тестовое занятие, воронка' });

    expect(result).toEqual({ text: 'Привет, мир', durationSec: 12.5 });
    const [sent] = requests;
    expect(sent.url).toBe('https://api.example.test/v1/audio/transcriptions');
    expect(sent.headers.authorization).toBe('Bearer sk-stt-key-0123456789');
    expect(sent.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
    const body = await (sent.body as Blob).text();
    expect(body).toContain('name="model"\r\n\r\nwhisper-1');
    expect(body).toContain('name="language"\r\n\r\nru');
    expect(body).toContain('name="prompt"\r\n\r\nтестовое занятие, воронка');
    expect(body).toContain('filename="audio.webm"');
    expect(onUsage).toHaveBeenCalledWith({ provider: 'openai-compat', model: 'whisper-1', audioSec: 12.5, costUsd: (12.5 / 60) * 0.006 });
  });

  it('falls back to the caller\'s duration for the counter when the server does not report one', async () => {
    const { stt, onUsage } = setup(jsonReply({ text: 'ок' }));
    const result = await stt.transcribe(audio(), { lang: 'ru', durationSec: 30 });
    expect(result).toEqual({ text: 'ок', durationSec: 30 });
    expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ audioSec: 30 }));
  });

  it('cuts an over-long prompt and leaves out empty options', async () => {
    const { stt, requests } = setup(jsonReply({ text: 'ок' }));
    await stt.transcribe(audio(), { lang: '', prompt: 'я'.repeat(5000) });
    const body = await (requests[0].body as Blob).text();
    expect(body).not.toContain('name="language"');
    expect(body.match(/я/g)).toHaveLength(800);
  });

  it('refuses without a key (hosted) but not for a local server', async () => {
    const hosted = setup(jsonReply({ text: 'x' }), { apiKey: '' });
    await expect(hosted.stt.transcribe(audio(), { lang: 'ru' })).rejects.toBeInstanceOf(NoKeyError);
    expect(hosted.requests).toHaveLength(0);

    const local = setup(jsonReply({ text: 'x' }), { apiKey: '', baseUrl: 'http://localhost:8080/v1' });
    await local.stt.transcribe(audio(), { lang: 'ru' });
    expect(local.requests[0].headers.authorization).toBeUndefined();
  });

  it('rejects empty and oversized recordings before uploading', async () => {
    const { stt, requests } = setup(jsonReply({ text: 'x' }));
    await expect(stt.transcribe(new Blob([]), { lang: 'ru' })).rejects.toBeInstanceOf(BadResponseError);
    const huge = { size: MAX_AUDIO_BYTES + 1, type: 'audio/webm' } as Blob;
    const error = (await stt.transcribe(huge, { lang: 'ru' }).catch((e: unknown) => e)) as ProviderError;
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.message).toContain('25 МБ');
    expect(requests).toHaveLength(0);
  });

  it('maps a rejected key and a malformed answer to typed errors', async () => {
    await expect(setup(jsonReply({ error: { message: 'bad' } }, 401)).stt.transcribe(audio(), { lang: 'ru' })).rejects.toBeInstanceOf(BadKeyError);
    await expect(setup(jsonReply({ nope: 1 })).stt.transcribe(audio(), { lang: 'ru' })).rejects.toBeInstanceOf(BadResponseError);
  });
});
