/**
 * Price table for the usage counter, USD per million tokens (input, output). Estimates for the screen
 * "Расход токенов", not billing: providers change prices and some bill more for very long prompts.
 * Unknown models simply have no cost.
 */
const PRICES: Readonly<Record<string, { input: number; output: number }>> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10 },
};

/** `claude-haiku-4-5-20251001` → `claude-haiku-4-5`. */
const DATE_SUFFIX = /-\d{8}$|-\d{4}-\d{2}-\d{2}$/;

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number | undefined {
  const price = PRICES[model] ?? PRICES[model.replace(DATE_SUFFIX, '')];
  if (!price) return undefined;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}

/** Speech recognition, USD per minute of audio. */
const STT_PRICES_PER_MINUTE: Readonly<Record<string, number>> = {
  'whisper-1': 0.006,
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-mini-transcribe': 0.003,
  'whisper-large-v3-turbo': 0.04 / 60,
  'whisper-large-v3': 0.111 / 60,
};

export function estimateSttCostUsd(model: string, audioSec: number): number | undefined {
  const perMinute = STT_PRICES_PER_MINUTE[model];
  return perMinute === undefined ? undefined : (audioSec / 60) * perMinute;
}
