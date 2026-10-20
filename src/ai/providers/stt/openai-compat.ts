import { z } from 'zod';
import { BadResponseError, NoKeyError, ProviderError } from '../../errors';
import { requestJson } from '../../http';
import type { HttpConfig } from '../../http';
import { estimateSttCostUsd } from '../pricing';
import { isLocalAddress, normalizeBaseUrl, reportSttUsage } from '../shared';
import type { SttProvider, SttUsageSink, TranscribeOptions, TranscribeResult } from '../types';
import { t } from '../../../i18n';

/**
 * `POST {baseUrl}/audio/transcriptions` (OpenAI, Groq and other compatible servers).
 * The multipart body is assembled by hand: it works in every runtime and can be inspected in tests.
 */

export interface OpenAiCompatSttConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  http?: HttpConfig;
  onUsage?: SttUsageSink;
}

/** The hosted APIs refuse bigger files. */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/** Whisper reads at most ~224 tokens of prompt; the tail of a longer hint is ignored anyway. */
const MAX_PROMPT_CHARS = 800;

const ResponseSchema = z.looseObject({ text: z.string(), duration: z.number().optional() });

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/flac': 'flac',
};

/** `audio/webm;codecs=opus` → `audio.webm`. The server decides the format by the extension. */
export function audioFileName(mime: string): string {
  const base = mime.split(';')[0].trim().toLowerCase();
  return `audio.${EXTENSIONS[base] ?? (base.split('/')[1] || 'webm')}`;
}

/** `ru-RU` → `ru`: the API wants a two-letter ISO-639-1 code. */
export function isoLanguage(lang: string): string {
  return lang.trim().split(/[-_]/)[0].toLowerCase();
}

export interface Multipart {
  body: Blob;
  contentType: string;
}

export function buildMultipart(
  fields: Readonly<Record<string, string>>,
  file: { field: string; filename: string; blob: Blob; mime: string },
  boundary: string = `----orbit${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`,
): Multipart {
  const parts: BlobPart[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
    file.blob,
    `\r\n--${boundary}--\r\n`,
  );
  return { body: new Blob(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export function createOpenAiCompatStt(config: OpenAiCompatSttConfig): SttProvider {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const http: HttpConfig = { ...config.http, secrets: [...(config.http?.secrets ?? []), config.apiKey] };

  async function transcribe(blob: Blob, options: TranscribeOptions): Promise<TranscribeResult> {
    const key = config.apiKey.trim();
    if (key === '' && !isLocalAddress(baseUrl)) throw new NoKeyError();
    if (blob.size === 0) throw new BadResponseError(t('Empty audio recording'));
    if (blob.size > MAX_AUDIO_BYTES) {
      throw new ProviderError(413, t('the recording is over 25 MB: split it into parts or recognise it another way'));
    }

    const mime = blob.type || 'audio/webm';
    const fields: Record<string, string> = { model: config.model, response_format: 'json' };
    const language = isoLanguage(options.lang);
    if (language !== '') fields.language = language;
    const hint = options.prompt?.trim();
    if (hint) fields.prompt = hint.slice(0, MAX_PROMPT_CHARS);

    const { body, contentType } = buildMultipart(fields, { field: 'file', filename: audioFileName(mime), blob, mime });
    const json = await requestJson(
      `${baseUrl}/audio/transcriptions`,
      {
        headers: { 'content-type': contentType, ...(key !== '' && { authorization: `Bearer ${key}` }) },
        body,
        signal: options.signal,
      },
      // Long recordings take a while to upload and recognize.
      { timeoutMs: 180_000, ...http },
    );

    const parsed = ResponseSchema.safeParse(json);
    if (!parsed.success) throw new BadResponseError(t('The recognition server sent a response without text'));
    const durationSec = parsed.data.duration ?? options.durationSec;

    const audioSec = durationSec ?? 0;
    const costUsd = estimateSttCostUsd(config.model, audioSec);
    await reportSttUsage(config.onUsage, { provider: 'openai-compat', model: config.model, audioSec, ...(costUsd !== undefined && { costUsd }) });
    return { text: parsed.data.text.trim(), ...(durationSec !== undefined && { durationSec }) };
  }

  return { id: 'openai-compat', transcribe };
}
