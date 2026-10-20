import { capturesRepo } from '../db';
import { localDayKey } from '../domain/dates';
import { countWords, truncate } from '../domain/text';
import type { Capture, ISODate } from '../domain/types';
import { t, msg } from '../i18n';

/**
 * Conversations with AI assistants become captures (`kind: 'ai_chat'`): the official exports of ChatGPT
 * and Claude (`conversations.json`) or a chat pasted as text. Everything read from a file is untrusted:
 * only text is taken, anything unexpected is skipped, nothing is ever interpreted as markup.
 */

export type ImportSource = 'chatgpt' | 'claude' | 'paste';

export interface ImportedMessage {
  role: 'user' | 'assistant';
  text: string;
  at?: ISODate;
}

export interface ImportedConversation {
  source: ImportSource;
  /** The id in the service the file came from; used to not import a conversation twice. */
  externalId?: string;
  title: string;
  startedAt?: ISODate;
  messages: ImportedMessage[];
  /** Characters of message text, for the preview. */
  chars: number;
}

export interface ParsedExport {
  source: ImportSource;
  conversations: ImportedConversation[];
  /** Entries of the file that were empty or unreadable. */
  skipped: number;
}

/** A file or text the importer cannot use; the message is ready to show. */
export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/** Longer conversations are cut when stored; extraction handles at most this much anyway. */
export const MAX_IMPORT_CHARS = 400_000;
const TITLE_MAX = 80;
const FALLBACK_TITLE = msg('Chat with the AI');

// ───────── Helpers for untrusted data ─────────

type Loose = Record<string, unknown>;
const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** Citation markers of ChatGPT are private-use characters around a technical id; they are noise in text. */
const CITATION_SPAN = /[^]*/g;
const PRIVATE_USE = /[-]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function cleanText(text: string): string {
  return text
    .replace(CITATION_SPAN, '')
    .replace(PRIVATE_USE, '')
    .replace(CONTROL, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isoOf(value: unknown): ISODate | undefined {
  const millis = typeof value === 'number' ? (value < 1e11 ? value * 1000 : value) : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(millis) || millis <= 0) return undefined;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function conversation(source: ImportSource, fields: { externalId?: string; title?: string; startedAt?: ISODate; messages: ImportedMessage[] }): ImportedConversation {
  const messages = fields.messages.filter((message) => message.text !== '');
  const firstUser = messages.find((message) => message.role === 'user')?.text;
  const title = truncate((fields.title ?? '').replace(/\s+/g, ' ').trim() || (firstUser ? firstUser.replace(/\s+/g, ' ') : t(FALLBACK_TITLE)), TITLE_MAX);
  return {
    source,
    ...(fields.externalId && { externalId: fields.externalId }),
    title,
    ...(fields.startedAt && { startedAt: fields.startedAt }),
    messages,
    chars: messages.reduce((sum, message) => sum + message.text.length, 0),
  };
}

// ───────── ChatGPT ─────────

/** Parts of a ChatGPT message: strings are text, a few object kinds carry text, the rest become a marker. */
function chatGptParts(content: unknown): string {
  if (!isObject(content)) return '';
  const type = asString(content.content_type);
  if (type === 'code') {
    const code = asString(content.text);
    return code ? `\`\`\`\n${code}\n\`\`\`` : '';
  }
  if (type !== undefined && !['text', 'multimodal_text'].includes(type)) return '';
  const pieces = asArray(content.parts).map((part) => {
    if (typeof part === 'string') return part;
    if (!isObject(part)) return '';
    const partType = asString(part.content_type);
    if (partType === 'audio_transcription') return asString(part.text) ?? '';
    if (partType === 'image_asset_pointer') return t('[image]');
    if (partType?.endsWith('_asset_pointer')) return t('[attachment]');
    return '';
  });
  return cleanText(pieces.filter((piece) => piece !== '').join('\n'));
}

function chatGptMessage(node: unknown): ImportedMessage | undefined {
  if (!isObject(node) || !isObject(node.message)) return undefined;
  const message = node.message;
  const role = isObject(message.author) ? asString(message.author.role) : undefined;
  if (role !== 'user' && role !== 'assistant') return undefined;
  if (isObject(message.metadata) && message.metadata.is_visually_hidden_from_conversation === true) return undefined;
  const text = chatGptParts(message.content);
  if (text === '') return undefined;
  const at = isoOf(message.create_time);
  return { role, text, ...(at && { at }) };
}

/** Number of nodes from `id` up to the root (cycles and dangling parents end the walk). */
function depthOf(mapping: Loose, id: string): number {
  const seen = new Set<string>();
  for (let cursor: unknown = id; typeof cursor === 'string' && cursor in mapping && !seen.has(cursor); ) {
    seen.add(cursor);
    const node: unknown = mapping[cursor];
    cursor = isObject(node) ? node.parent : undefined;
  }
  return seen.size;
}

/** The messages of the branch the user was looking at: from `current_node` up to the root. */
function chatGptBranch(mapping: Loose, currentNode: unknown): unknown[] {
  let id: string | undefined = typeof currentNode === 'string' && currentNode in mapping ? currentNode : undefined;
  if (id === undefined) {
    // No pointer: the end of the deepest chain.
    const leaves = Object.entries(mapping).filter(([, node]) => isObject(node) && asArray(node.children).length === 0);
    id = leaves.map(([leaf]) => leaf).sort((x, y) => depthOf(mapping, y) - depthOf(mapping, x))[0];
  }
  const chain: unknown[] = [];
  const seen = new Set<string>();
  while (id !== undefined && id in mapping && !seen.has(id)) {
    seen.add(id);
    const node: unknown = mapping[id];
    chain.push(node);
    const parent: unknown = isObject(node) ? node.parent : undefined;
    id = typeof parent === 'string' ? parent : undefined;
  }
  return chain.reverse();
}

function fromChatGpt(entry: Loose): ImportedConversation | undefined {
  if (!isObject(entry.mapping)) return undefined;
  const messages = chatGptBranch(entry.mapping, entry.current_node)
    .map(chatGptMessage)
    .filter((message): message is ImportedMessage => message !== undefined);
  const externalId = asString(entry.conversation_id) ?? asString(entry.id);
  const startedAt = isoOf(entry.create_time) ?? messages.find((message) => message.at)?.at;
  return conversation('chatgpt', { externalId, title: asString(entry.title), startedAt, messages });
}

// ───────── Claude ─────────

function claudeText(message: Loose): string {
  const blocks = asArray(message.content)
    .map((block) => (isObject(block) && block.type === 'text' ? asString(block.text) : undefined))
    .filter((text): text is string => text !== undefined && text.trim() !== '');
  const text = blocks.length > 0 ? blocks.join('\n') : (asString(message.text) ?? '');
  const files = asArray(message.attachments)
    .concat(asArray(message.files))
    .map((file) => (isObject(file) ? asString(file.file_name) : undefined))
    .filter((name): name is string => name !== undefined && name !== '')
    .map((name) => t('[attachment: {truncate}]', { truncate: truncate(cleanText(name), 80) }));
  return cleanText([text, ...files].filter((piece) => piece !== '').join('\n'));
}

function fromClaude(entry: Loose): ImportedConversation | undefined {
  if (!Array.isArray(entry.chat_messages)) return undefined;
  const messages: ImportedMessage[] = [];
  for (const raw of entry.chat_messages) {
    if (!isObject(raw)) continue;
    const role = raw.sender === 'human' ? 'user' : raw.sender === 'assistant' ? 'assistant' : undefined;
    const text = claudeText(raw);
    if (!role || text === '') continue;
    const at = isoOf(raw.created_at);
    messages.push({ role, text, ...(at && { at }) });
  }
  const startedAt = isoOf(entry.created_at) ?? messages.find((message) => message.at)?.at;
  return conversation('claude', { externalId: asString(entry.uuid), title: asString(entry.name), startedAt, messages });
}

// ───────── Files ─────────

/** Finds the list of conversations in what the file holds: the array itself, `{conversations: […]}` or one conversation. */
function entriesOf(root: unknown): unknown[] {
  if (Array.isArray(root)) return root;
  if (isObject(root) && Array.isArray(root.conversations)) return root.conversations;
  if (isObject(root) && (isObject(root.mapping) || Array.isArray(root.chat_messages))) return [root];
  return [];
}

export function parseExportData(root: unknown): ParsedExport {
  const entries = entriesOf(root);
  if (entries.length === 0) {
    throw new ImportError(t('The file has no conversations. A conversations.json file from a ChatGPT or Claude data export is needed.'));
  }
  const conversations: ImportedConversation[] = [];
  const sources = new Set<ImportSource>();
  let skipped = 0;
  for (const entry of entries) {
    const parsed = isObject(entry) ? (isObject(entry.mapping) ? fromChatGpt(entry) : Array.isArray(entry.chat_messages) ? fromClaude(entry) : undefined) : undefined;
    if (!parsed || parsed.messages.length === 0) {
      skipped++;
      continue;
    }
    conversations.push(parsed);
    sources.add(parsed.source);
  }
  if (conversations.length === 0) {
    const recognized = entries.some((entry) => isObject(entry) && (isObject(entry.mapping) || Array.isArray(entry.chat_messages)));
    throw new ImportError(
      recognized
        ? t('The file has conversations, but no text messages in them.')
        : t('Could not recognise the file format. conversations.json from ChatGPT and Claude is supported.'),
    );
  }
  const source = sources.size === 1 ? [...sources][0] : 'chatgpt';
  return { source, conversations, skipped };
}

/** Parses the text of a `conversations.json`. */
export function parseExport(json: string): ParsedExport {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    throw new ImportError(t('The file does not look like JSON. Choose conversations.json from a ChatGPT or Claude data export.'));
  }
  return parseExportData(root);
}

// ───────── Pasted text ─────────

// i18n-ignore-start: speaker labels of pasted chats, both languages
const USER_LABELS = ['вы сказали', 'you said', 'я', 'вы', 'you', 'user', 'human', 'пользователь', 'человек'];
const ASSISTANT_LABELS = ['chatgpt сказал', 'chatgpt said', 'claude responded', 'claude сказал', 'chatgpt', 'claude', 'ии', 'ai', 'assistant', 'ассистент', 'gpt', 'gemini', 'copilot', 'deepseek', 'grok', 'бот'];
// i18n-ignore-end
const LABEL_LINE = new RegExp(`^(${[...USER_LABELS, ...ASSISTANT_LABELS].map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\s*:\\s*(.*)$`, 'iu');

/** "Я: …" / "ChatGPT: …" / "You said: …" lines split a pasted chat into turns; text before the first label is the author's. */
function splitTurns(text: string): ImportedMessage[] | undefined {
  const turns: { role: ImportedMessage['role']; lines: string[] }[] = [{ role: 'user', lines: [] }];
  for (const line of text.split('\n')) {
    const match = LABEL_LINE.exec(line.trim());
    if (match) turns.push({ role: USER_LABELS.includes(match[1].toLowerCase()) ? 'user' : 'assistant', lines: [match[2]] });
    else turns[turns.length - 1].lines.push(line);
  }
  const messages = turns.map((turn) => ({ role: turn.role, text: cleanText(turn.lines.join('\n')) })).filter((turn) => turn.text !== '');
  const hasBoth = new Set(messages.map((message) => message.role)).size === 2;
  return messages.length >= 2 && hasBoth && turns.length > 1 ? messages : undefined;
}

/**
 * A chat pasted as text. With role labels («Я:», «ChatGPT:», «You said:») it becomes turns, otherwise one
 * message. Either way it is one conversation, ready for `importConversations`.
 */
export function parsePastedChat(text: string, { title }: { title?: string } = {}): ImportedConversation {
  const cleaned = cleanText(text);
  if (cleaned === '') throw new ImportError(t('Paste the text of the conversation.'));
  const messages = splitTurns(cleaned) ?? [{ role: 'user' as const, text: cleaned }];
  return conversation('paste', { title, messages });
}

// ───────── Captures ─────────

const ASSISTANT_NAME: Record<ImportSource, string> = { chatgpt: 'ChatGPT', claude: 'Claude', get paste() { return t('AI') } };
const CUT_NOTE = msg('\n\n[… conversation truncated: too long for one record]');

/** The transcript as stored in the capture: «Я: …» and «ChatGPT: …», turn after turn. */
export function conversationText(conv: ImportedConversation): string {
  const text = conv.messages.map((message) => `${message.role === 'user' ? t('Me') : ASSISTANT_NAME[conv.source]}: ${message.text}`).join('\n\n');
  return text.length > MAX_IMPORT_CHARS ? `${text.slice(0, MAX_IMPORT_CHARS)}${t(CUT_NOTE)}` : text;
}

const SOURCE_APP: Record<ImportSource, string> = { chatgpt: 'ChatGPT', claude: 'Claude', get paste() { return t('AI chat') } };

function sourceUrl(conv: ImportedConversation): string | undefined {
  if (!conv.externalId || !/^[\w-]{6,80}$/.test(conv.externalId)) return undefined;
  if (conv.source === 'chatgpt') return `https://chatgpt.com/c/${conv.externalId}`;
  if (conv.source === 'claude') return `https://claude.ai/chat/${conv.externalId}`;
  return undefined;
}

export function conversationToCapture(conv: ImportedConversation, now: Date = new Date()): capturesRepo.NewCapture {
  const createdAt = conv.startedAt ?? now.toISOString();
  const url = sourceUrl(conv);
  return {
    kind: 'ai_chat',
    title: conv.title,
    text: conversationText(conv),
    createdAt,
    day: localDayKey(createdAt),
    source: { app: SOURCE_APP[conv.source], importedFrom: conv.source, ...(url && { url }) },
  };
}

export interface ImportOptions {
  /** Do not import a conversation that an earlier import already stored (by its link). Default true. */
  skipExisting?: boolean;
  now?: Date;
  /** Called after each conversation, for a progress bar. */
  onProgress?(done: number, total: number): void;
}

export interface ImportSkip {
  title: string;
  reason: 'already-imported' | 'empty';
}

export interface ImportResult {
  created: Capture[];
  skipped: ImportSkip[];
}

/** Stores the conversations as captures waiting for processing (status `transcribed`). */
export async function importConversations(conversations: readonly ImportedConversation[], options: ImportOptions = {}): Promise<ImportResult> {
  const known = new Set<string>();
  if (options.skipExisting !== false) {
    for (const capture of await capturesRepo.list({ kind: 'ai_chat' })) if (capture.source?.url) known.add(capture.source.url);
  }
  const created: Capture[] = [];
  const skipped: ImportSkip[] = [];
  for (const [index, conv] of conversations.entries()) {
    const draft = conversationToCapture(conv, options.now);
    if (conv.messages.length === 0 || countWords(draft.text ?? '') === 0) skipped.push({ title: conv.title, reason: 'empty' });
    else if (draft.source?.url && known.has(draft.source.url)) skipped.push({ title: conv.title, reason: 'already-imported' });
    else {
      created.push(await capturesRepo.create(draft));
      if (draft.source?.url) known.add(draft.source.url);
    }
    options.onProgress?.(index + 1, conversations.length);
  }
  return { created, skipped };
}
