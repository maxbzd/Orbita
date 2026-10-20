import { estimateTokens } from '../../domain/tokens';
import type { UsagePurpose } from '../../domain/types';
import { AbortedError } from '../errors';
import { buildRepairUser, parseModelText } from '../json';
import { makeUsage } from './shared';
import type { ChatRequest, ChatResult, LlmProvider, StructuredRequest, StructuredResult } from './types';
import { t, msg } from '../../i18n';

/**
 * "Через буфер обмена": no network at all. A request becomes a ready-to-paste prompt; the UI shows it,
 * the user takes it to any AI chat and pastes the answer back. The answer goes through exactly the same
 * parsing and zod validation as an answer from an API; a bad paste does not fail the request — the
 * UI shows what is wrong (and a ready repair prompt) and waits for another paste.
 */

export type ManualRequestKind = 'structured' | 'chat';

/** What the UI needs to render the waiting request. */
export interface ManualRequestView {
  id: number;
  kind: ManualRequestKind;
  purpose: UsagePurpose;
  /** Text to copy into an AI chat. */
  prompt: string;
  /** Why the last pasted answer was not accepted (Russian), until a good one arrives. */
  lastError?: string;
  /** After a bad paste: the same prompt plus what was wrong, for the same chat. */
  repairPrompt?: string;
}

export type SubmitResult = { ok: true } | { ok: false; error: string };

export interface ManualBridge {
  /** The request waiting for an answer (the oldest one), if any. */
  getPending(): ManualRequestView | undefined;
  /** Shortcut for `getPending()?.prompt`. */
  getPendingPrompt(): string | undefined;
  /** Gives the pasted answer to the waiting request. */
  submitResponse(text: string): SubmitResult;
  /** The user gave up: the waiting request fails with `AbortedError`. */
  cancelPending(): void;
  /** Called after every change of the pending request; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export interface ManualProvider extends LlmProvider {
  readonly id: 'manual';
  readonly bridge: ManualBridge;
}

interface ManualEntryInput {
  view: Omit<ManualRequestView, 'id'>;
  /** Returns the problem text, or undefined when the answer was accepted. */
  accept(text: string): string | undefined;
  reject(error: unknown): void;
}

interface PendingEntry extends Omit<ManualEntryInput, 'view'> {
  view: ManualRequestView;
}

interface ManualHub {
  bridge: ManualBridge;
  enqueue(entry: ManualEntryInput, signal?: AbortSignal): void;
}

const EMPTY_PASTE = msg('You pasted nothing. Copy the whole AI answer and paste it here.');

export function createManualBridge(): ManualHub {
  const queue: PendingEntry[] = [];
  const listeners = new Set<() => void>();
  let nextId = 1;

  const notify = () => listeners.forEach((listener) => listener());
  const remove = (entry: PendingEntry) => {
    const index = queue.indexOf(entry);
    if (index !== -1) queue.splice(index, 1);
    notify();
  };

  const bridge: ManualBridge = {
    getPending: () => queue[0]?.view,
    getPendingPrompt: () => queue[0]?.view.prompt,
    submitResponse(text) {
      const entry = queue[0];
      if (!entry) return { ok: false, error: t('There is nothing to paste right now: no pending request.') };
      if (text.trim() === '') return { ok: false, error: t(EMPTY_PASTE) };
      const problem = entry.accept(text);
      if (problem === undefined) {
        remove(entry);
        return { ok: true };
      }
      entry.view = {
        ...entry.view,
        lastError: t('Could not parse the answer: {problem}. Make sure only JSON is pasted and try again.', { problem }),
        repairPrompt: buildRepairUser(entry.view.prompt, { previous: text, problem }),
      };
      notify();
      return { ok: false, error: entry.view.lastError ?? problem };
    },
    cancelPending() {
      const entry = queue[0];
      if (!entry) return;
      remove(entry);
      entry.reject(new AbortedError());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return {
    bridge,
    enqueue(entry, signal) {
      const pending: PendingEntry = { ...entry, view: { ...entry.view, id: nextId++ } };
      if (signal?.aborted) {
        entry.reject(new AbortedError());
        return;
      }
      signal?.addEventListener(
        'abort',
        () => {
          if (queue.includes(pending)) {
            remove(pending);
            pending.reject(new AbortedError());
          }
        },
        { once: true },
      );
      queue.push(pending);
      notify();
    },
  };
}

function schemaBlock(jsonSchema: object): string {
  return JSON.stringify(jsonSchema, null, 2);
}

/** The prompt for a structured request: the instructions, the material and the exact answer format. */
export function buildManualPrompt(system: string, user: string, jsonSchema: object): string {
  return [
    system.trim(),
    '',
    t('=== DATA ==='),
    user.trim(),
    '',
    t('=== ANSWER FORMAT ==='),
    t('Answer with a single JSON object that strictly matches this JSON Schema. Use null for values that do not apply.'),
    t('No text before or after, no explanations and no ``` fences.'),
    schemaBlock(jsonSchema),
  ].join('\n');
}

function buildChatPrompt(system: string, messages: ChatRequest['messages']): string {
  const dialogue = messages.map((message) => `${message.role === 'user' ? t('User') : t('Assistant')}: ${message.content}`).join('\n\n');
  return [system.trim(), '', t('=== DIALOGUE ==='), dialogue, '', t("Answer the user's last message.")].join('\n');
}

export function createManualProvider(hub: ManualHub = createManualBridge()): ManualProvider {
  const { bridge, enqueue } = hub;

  function structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const prompt = buildManualPrompt(request.system, request.user, request.jsonSchema);
    return new Promise((resolve, reject) => {
      enqueue(
        {
          view: { kind: 'structured', purpose: request.purpose, prompt },
          accept: (text) => {
            const outcome = parseModelText(text, request.zod);
            if (!outcome.ok) return outcome.problem;
            resolve({ data: outcome.data, usage: makeUsage('manual', 'clipboard', estimateTokens(prompt), estimateTokens(text)) });
            return undefined;
          },
          reject,
        },
        request.signal,
      );
    });
  }

  function chat(request: ChatRequest): Promise<ChatResult> {
    const prompt = buildChatPrompt(request.system, request.messages);
    return new Promise((resolve, reject) => {
      enqueue(
        {
          view: { kind: 'chat', purpose: request.purpose, prompt },
          accept: (text) => {
            request.onToken?.(text);
            resolve({ text, usage: makeUsage('manual', 'clipboard', estimateTokens(prompt), estimateTokens(text)) });
            return undefined;
          },
          reject,
        },
        request.signal,
      );
    });
  }

  return {
    id: 'manual',
    bridge,
    structured,
    chat,
    test: async () => ({ ok: true, message: t('The “via clipboard” mode needs no connection: the prompt is copied and the answer is pasted by hand.') }),
  };
}

/** The bridge the app uses: the pipeline waits on it, the "вставьте ответ" sheet shows and feeds it. */
const sharedHub = createManualBridge();
export const manualBridge: ManualBridge = sharedHub.bridge;
export const sharedManualProvider: ManualProvider = createManualProvider(sharedHub);
