import type { capturesRepo } from '../../db';
import { truncate } from '../../domain/text';

/**
 * The Android "Поделиться" target (`share_target`, method GET): the browser puts `title`, `text` and `url` into the query
 * before the `#/share` fragment. Everything that arrives is foreign input: it is cleaned of control and direction
 * characters, capped in length and only ever used as text (never as markup, never as a link we follow).
 */

export const SHARE_LIMITS = { title: 200, text: 20_000, url: 2_000 } as const;

export interface SharedContent {
  title: string;
  /** What will be saved as the capture text: the text, with the title and the link when they add something. */
  text: string;
  /** An http(s) link, when one arrived. */
  url?: string;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`]+/i;

function clean(value: string | null | undefined, max: number): string {
  if (!value) return '';
  return Array.from(value.replace(/\r\n?/g, '\n').replace(CONTROL, ''))
    .slice(0, max)
    .join('')
    .trim();
}

/** Only http and https links are links; `javascript:`, `data:` and the like stay plain text. */
export function safeHttpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    const href = url.href;
    return href.length <= SHARE_LIMITS.url ? href : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the shared content from query strings (`?title=…&text=…&url=…`); null when nothing usable arrived. */
export function parseShare(...queries: Array<string | URLSearchParams | undefined>): SharedContent | null {
  let title = '';
  let text = '';
  let rawUrl = '';
  for (const query of queries) {
    if (!query) continue;
    const params = typeof query === 'string' ? new URLSearchParams(query.startsWith('?') ? query.slice(1) : query) : query;
    title ||= clean(params.get('title'), SHARE_LIMITS.title);
    text ||= clean(params.get('text'), SHARE_LIMITS.text);
    rawUrl ||= clean(params.get('url'), SHARE_LIMITS.url);
  }

  let url = rawUrl ? safeHttpUrl(rawUrl) : undefined;
  // A link that is not http(s) is not dropped silently: it stays in the text, inert.
  if (rawUrl && !url && !text.includes(rawUrl)) text = text ? `${text}\n${rawUrl}` : rawUrl;
  if (!url) {
    const found = URL_IN_TEXT.exec(text)?.[0];
    url = found ? safeHttpUrl(found.replace(/[.,;:!?)»]+$/, '')) : undefined;
  }

  const parts: string[] = [];
  if (title && !text.includes(title)) parts.push(title);
  if (text) parts.push(text);
  if (url && !text.includes(url) && !(url.endsWith('/') && text.includes(url.slice(0, -1)))) parts.push(url);
  const combined = Array.from(parts.join('\n\n')).slice(0, SHARE_LIMITS.text).join('').trim();
  if (combined === '') return null;
  return { title, text: combined, ...(url && { url }) };
}

/** The capture that confirming a share creates. The text is the user's (possibly edited) one. */
export function shareToCapture(content: Pick<SharedContent, 'title' | 'url'>, text: string): capturesRepo.NewCapture {
  const clean_ = clean(text, SHARE_LIMITS.text);
  return {
    kind: 'text',
    text: clean_,
    ...(content.title && { title: truncate(content.title, 120) }),
    status: 'transcribed',
    source: { importedFrom: 'share', ...(content.url && { url: content.url }) },
  };
}
