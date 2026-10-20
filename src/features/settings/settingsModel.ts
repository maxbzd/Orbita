import type { CaptureContext, PrivacyLevel, SttProviderId, AiProviderId } from '../../domain/types';
import type { UsageDay } from '../../db/repos/usage';
import { objectsCount, peopleCount, projectsCount, recordsCount } from '../../domain/counts';
import { t } from '../../i18n';

/** Pure helpers of the settings screen (no React, no storage), kept apart so they can be tested. */

// ───────── API keys ─────────

/** `sk-ant-api03-…-a3f9` → `••••••••a3f9`. Never more than the last four characters, and none at all for a short key. */
export function maskKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed === '') return '';
  const tail = trimmed.length >= 12 ? trimmed.slice(-4) : '';
  return `••••••••${tail}`;
}

// ───────── Provider hosts and the Content-Security-Policy ─────────

export interface ParsedBaseUrl {
  ok: boolean;
  host?: string;
  origin?: string;
  error?: string;
}

/** Checks the address of an OpenAI-compatible server. Only https (or http on this machine) is accepted. */
export function parseBaseUrl(value: string): ParsedBaseUrl {
  const text = value.trim();
  if (text === '') return { ok: false, error: t('Enter the server address.') };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: t('That does not look like an address. Example: https://api.openai.com/v1') };
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return { ok: false, error: t('The address must start with https://. Only your own computer (localhost) may go without encryption.') };
  }
  return { ok: true, host: url.host, origin: url.origin };
}

/**
 * The hosts the page may talk to, read from the `connect-src` of the Content-Security-Policy meta tag in
 * index.html. `null` when the page has no such policy (the dev server strips it): then nothing is restricted.
 * `'self'` and other keywords are left out; only origins stay.
 */
export function readCspConnectOrigins(doc: Document | undefined = typeof document === 'undefined' ? undefined : document): string[] | null {
  const meta = doc?.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy" i]');
  const policy = meta?.getAttribute('content');
  if (!policy) return null;
  const directive = policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('connect-src'));
  if (!directive) return null;
  return directive
    .split(/\s+/)
    .slice(1)
    .filter((token) => /^https?:\/\//.test(token));
}

export type CspVerdict =
  /** The page is not restricted (dev server) or the host is on the list. */
  | { status: 'ok' }
  /** The host is not on the list: requests to it will be blocked until it is added in index.html. */
  | { status: 'blocked'; origin: string }
  | { status: 'invalid'; message: string };

export function checkCsp(baseUrl: string, allowed: readonly string[] | null): CspVerdict {
  const parsed = parseBaseUrl(baseUrl);
  if (!parsed.ok || !parsed.origin) return { status: 'invalid', message: parsed.error ?? t('Invalid address.') };
  if (allowed === null || allowed.includes(parsed.origin)) return { status: 'ok' };
  return { status: 'blocked', origin: parsed.origin };
}

// ───────── Labels ─────────

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  anthropic: 'Anthropic',
  get 'openai-compat'() { return t('OpenAI-compat.') },
  get manual() { return t('No AI') },
};

export const AI_PROVIDER_HINTS: Record<AiProviderId, string> = {
  get anthropic() { return t('Claude directly with your key. The key is stored only on this device.') },
  get 'openai-compat'() { return t('OpenAI, Groq, OpenRouter, your own model: any server with the same protocol.') },
  get manual() { return t('Manual mode: the app prepares a request, you paste it into any AI chat and bring the answer back. No key needed.') },
};

export const STT_PROVIDER_LABELS: Record<SttProviderId, string> = {
  get browser() { return t('In the browser') },
  get 'openai-compat'() { return t('OpenAI-compatible', undefined, 'provider') },
};

export const PRIVACY_LABELS: Record<PrivacyLevel, string> = { get full() { return t('Full names') }, get initials() { return t('Initials') }, get anonymous() { return t('Person A') } };

export const PRIVACY_HINTS: Record<PrivacyLevel, string> = {
  get full() { return t("People's names go into the context as they are.") },
  get initials() { return t('Instead of “Maria Ivanova” it sends “M. I.”.') },
  get anonymous() { return t('People become “Person A”, “Person B”: names do not leave at all.') },
};

export const CONTEXT_LABELS: Record<CaptureContext, string> = { get walk() { return t('Walk') }, get home() { return t('At home') }, get transit() { return t('On the way') }, get work() { return t('Work') }, get other() { return t('Other') } };

export { LANGUAGES } from '../../domain/languages';

/** Thresholds offered for auto-accept. */
export const AUTO_ACCEPT_STEPS = [0.7, 0.8, 0.85, 0.9, 0.95] as const;

/** The nearest offered threshold, so an odd stored value still selects something. */
export function nearestAutoAcceptStep(value: number): (typeof AUTO_ACCEPT_STEPS)[number] {
  return AUTO_ACCEPT_STEPS.reduce((best, step) => (Math.abs(step - value) < Math.abs(best - value) ? step : best));
}

/** Common work jargon offered as one tap: speech recognition tends to mangle these. */
export const SUGGESTED_TERMS: readonly string[] = ['OKR', 'KPI', 'MVP', 'CRM', 'roadmap', 'backlog', 'standup', 'retro'];

export const AUTO_LOCK_LABELS: Record<number, string> = { get 0() { return t('Never') }, get 1() { return t('1 min') }, get 5() { return t('5 min') }, get 15() { return t('15 min') }, get 60() { return t('1 hour') } };

// ───────── Usage ─────────

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  audioSec: number;
  costUsd: number;
}

export function totalUsage(days: readonly UsageDay[]): UsageTotals {
  return days.reduce<UsageTotals>(
    (sum, day) => ({
      calls: sum.calls + day.calls,
      inputTokens: sum.inputTokens + day.inputTokens,
      outputTokens: sum.outputTokens + day.outputTokens,
      audioSec: sum.audioSec + day.audioSec,
      costUsd: sum.costUsd + day.costUsd,
    }),
    { calls: 0, inputTokens: 0, outputTokens: 0, audioSec: 0, costUsd: 0 },
  );
}

/** `0.0042` → `≈ $0,004`; `0` → `—`. The prices are an estimate from a built-in table. */
export function formatCost(usd: number): string {
  if (usd <= 0) return '—';
  if (usd < 0.01) return '≈ <$0,01';
  return `≈ $${usd.toFixed(2).replace('.', ',')}`;
}

// ───────── Backup preview ─────────

/** `{ captures: 2, items: 11 }` → `2 записи, 11 объектов`; used in the import preview. */
export function backupSummaryLine(counts: Readonly<Record<string, number>>): string {
  const counters: ReadonlyArray<[string, (n: number) => string]> = [['captures', recordsCount], ['items', objectsCount], ['people', peopleCount], ['projects', projectsCount]];
  const parts = counters.flatMap(([key, count]) => ((counts[key] ?? 0) > 0 ? [count(counts[key] ?? 0)] : []));
  return parts.length > 0 ? parts.join(', ') : t('empty');
}
