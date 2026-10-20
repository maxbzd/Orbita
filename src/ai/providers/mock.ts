import { estimateTokens } from '../../domain/tokens';
import { AbortedError, BadResponseError } from '../errors';
import { sleep } from '../http';
import { validateValue } from '../json';
import { SCHEMA_NAMES } from '../prompts/schemas';
import type { Extraction, PatternsResult, ReviewDraft } from '../prompts/schemas';
import { mockExtraction } from './mock-extract';
import { makeUsage, reportUsage } from './shared';
import type { ProviderHooks } from './shared';
import type { ChatRequest, ChatResult, LlmProvider, StructuredRequest, StructuredResult } from './types';
import { t } from '../../i18n';

/**
 * Deterministic LLM for tests, demos and `VITE_MOCK_AI=1`: no network, same input → same output.
 * Its answers go through the same zod validation as a real model's, so a prompt or schema change that
 * breaks the contract fails here as well.
 */

export interface MockLlmConfig extends ProviderHooks {
  /** Artificial latency per call, so that "processing…" states are visible in demos. */
  delayMs?: number;
}

const DAY_PATTERN = /(?:Запись сделана|Record made): (\d{4}-\d{2}-\d{2})/;
const RECORD_PATTERN = /<record>\n([\s\S]*)\n<\/record>/;

function recordOf(user: string): { text: string; captureDay: string; context: string } {
  const text = RECORD_PATTERN.exec(user)?.[1] ?? user;
  const recordStart = user.search(/## (?:Record|Запись)/);
  return {
    text,
    captureDay: DAY_PATTERN.exec(user)?.[1] ?? new Date().toISOString().slice(0, 10),
    context: recordStart === -1 ? '' : user.slice(0, recordStart),
  };
}

// ───────── Review ─────────

type Loose = Record<string, unknown>;
const asObject = (value: unknown): Loose => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Loose) : {});
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);

function mockReview(user: string): ReviewDraft {
  let digest: Loose = {};
  try {
    const heading = /## (?:Period summary|Сводка периода) \(JSON\)\n/.exec(user);
    digest = asObject(JSON.parse(user.slice(heading ? heading.index + heading[0].length : 0)));
  } catch {
    // An unreadable digest still gets a generic review.
  }
  const stats = asObject(digest.stats);
  const captures = asNumber(stats.captures);
  const wins = asList(digest.wins);
  const overdue = asList(digest.overdue).map((entry) => String(asObject(entry).title ?? '')).filter((title) => title !== '');

  const steps =
    overdue.length > 0
      ? overdue.slice(0, 3).map((title) => t('• Close or reschedule: {title}', { title })).join('\n')
      : t('• Pick one task that moves the main thing forward and do it first.');
  return {
    headline: captures > 0 ? t('{captures} records and {count} closed tasks in the period', { captures, count: wins.length }) : t('Almost no records in the period'),
    sections: [
      { title: t('Main points'), body: t('Records in the period: {captures}. Tasks closed: {count}. Overdue: {count2}.', { captures, count: wins.length, count2: overdue.length }) },
      { title: t('Next steps'), body: steps },
    ],
    questions: [
      overdue[0] ? t('What keeps you from closing “{v}”?', { v: overdue[0] }) : t('What from this period would you like to repeat?'),
      t('Which decision of this period would you make differently?'),
    ],
  };
}

// ───────── Patterns ─────────

function mockPatterns(user: string): PatternsResult {
  const byTag = new Map<string, { ref: string; day: string }[]>();
  for (const block of user.split('\n### ').map((part, index) => (index === 0 ? part : `### ${part}`))) {
    const header = /### (c\d+) — (\d{4}-\d{2}-\d{2})/.exec(block);
    const tags = /(?:Теги|Tags): (.*)/.exec(block)?.[1];
    if (!header || !tags) continue;
    for (const tag of tags.split(',').map((entry) => entry.trim()).filter(Boolean)) {
      byTag.set(tag, [...(byTag.get(tag) ?? []), { ref: header[1], day: header[2] }]);
    }
  }

  /** Known patterns are listed as `- p1 [status, kind] Title: description`. */
  const knownRef = (title: string): string | null => {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^- (p\\d+) \\[[^\\]]*\\] ${escaped}:`, 'm').exec(user)?.[1] ?? null;
  };
  const patterns: PatternsResult['patterns'] = [];
  for (const [tag, entries] of byTag) {
    const days = new Set(entries.map((entry) => entry.day));
    if (days.size < 2) continue;
    const title = t('Recurring theme: {tag}', { tag });
    patterns.push({
      existingId: knownRef(title),
      title,
      description: t('The theme “{tag}” appears in {count} records over {size} different days.', { tag, count: entries.length, size: days.size }),
      kind: 'recurring_topic',
      confidence: Math.min(0.85, 0.3 + 0.12 * entries.length),
      suggestion: null,
      evidence: entries.map((entry) => ({ ref: entry.ref, quote: null })),
    });
  }
  return { patterns: patterns.sort((a, b) => b.confidence - a.confidence).slice(0, 6) };
}

// ───────── Provider ─────────

function chatAnswer(request: ChatRequest): string {
  const materials = [...request.system.matchAll(/^\[([a-z]\d+)\] (.+)$/gm)].map((match) => `• ${match[2]} [${match[1]}]`);
  if (request.purpose === 'ask') {
    return materials.length > 0
      ? t('Here is what was found for your question:\n{v}', { v: materials.slice(0, 3).join('\n') })
      : t('Nothing was found in the records for this question.');
  }
  const last = request.messages[request.messages.length - 1]?.content ?? '';
  return t('Test answer to: “{v}”', { v: last.slice(0, 80) });
}

export function createMockLlmProvider(config: MockLlmConfig = {}): LlmProvider {
  const pause = async (signal?: AbortSignal) => {
    if (signal?.aborted) throw new AbortedError();
    if ((config.delayMs ?? 0) > 0) await sleep(config.delayMs ?? 0, signal);
  };

  async function structured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    await pause(request.signal);
    let answer: Extraction | ReviewDraft | PatternsResult;
    switch (request.schemaName) {
      case SCHEMA_NAMES.extraction:
        answer = mockExtraction(recordOf(request.user));
        break;
      case SCHEMA_NAMES.review:
        answer = mockReview(request.user);
        break;
      case SCHEMA_NAMES.patterns:
        answer = mockPatterns(request.user);
        break;
      default:
        throw new BadResponseError(t('The test AI does not know the schema “{schemaName}”', { schemaName: request.schemaName }));
    }
    const outcome = validateValue(answer, request.zod);
    if (!outcome.ok) throw new BadResponseError(t("The test AI's answer failed validation: {problem}", { problem: outcome.problem }));

    const usage = makeUsage('mock', 'mock', estimateTokens(`${request.system}\n${request.user}`), estimateTokens(JSON.stringify(answer)));
    await reportUsage(config.onUsage, usage, request.purpose);
    return { data: outcome.data, usage };
  }

  async function chat(request: ChatRequest): Promise<ChatResult> {
    await pause(request.signal);
    const text = chatAnswer(request);
    for (const piece of text.split(/(?<=\s)/)) {
      if (request.signal?.aborted) throw new AbortedError();
      request.onToken?.(piece);
    }
    const prompt = `${request.system}\n${request.messages.map((message) => message.content).join('\n')}`;
    const usage = makeUsage('mock', 'mock', estimateTokens(prompt), estimateTokens(text));
    await reportUsage(config.onUsage, usage, request.purpose);
    return { text, usage };
  }

  return {
    id: 'mock',
    structured,
    chat,
    test: async () => ({ ok: true, message: t('The test AI works offline: answers are templated.') }),
  };
}
