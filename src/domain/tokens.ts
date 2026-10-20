import { t } from '../i18n';
/**
 * Rough token estimate for budgeting prompts and context packs. Deliberately conservative
 * (slightly high): Cyrillic costs about twice as many tokens per character as English.
 * Not a tokenizer — never use it for billing, only for "will this fit" decisions.
 */

const CHARS_PER_TOKEN = {
  cyrillic: 2.5,
  latin: 4,
  digit: 2.5,
} as const;
const TOKENS_PER_PUNCTUATION = 0.7;
const TOKENS_PER_OTHER_CHAR = 1.5;

const CYRILLIC = /\p{Script=Cyrillic}/u;
const LATIN = /\p{Script=Latin}/u;
const DIGIT = /\p{Nd}/u;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/u;

export function estimateTokens(text: string): number {
  // Count per class first and divide once: summing 1/2.5 per character drifts (400 × 0.4 → 160.00000000000003).
  let cyrillic = 0;
  let latin = 0;
  let digits = 0;
  let punctuation = 0;
  let other = 0;
  for (const char of text) {
    if (WHITESPACE.test(char)) continue;
    if (CYRILLIC.test(char)) cyrillic++;
    else if (LATIN.test(char)) latin++;
    else if (DIGIT.test(char)) digits++;
    else if (PUNCTUATION.test(char)) punctuation++;
    else other++;
  }
  return Math.ceil(
    cyrillic / CHARS_PER_TOKEN.cyrillic +
      latin / CHARS_PER_TOKEN.latin +
      digits / CHARS_PER_TOKEN.digit +
      punctuation * TOKENS_PER_PUNCTUATION +
      other * TOKENS_PER_OTHER_CHAR,
  );
}

const compact = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

/** `980` → `980`, `12340` → `12,3 тыс.`, `1_200_000` → `1,2 млн`. */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return t('{format}M', { format: compact.format(count / 1_000_000) });
  if (count >= 1_000) return t('{format}k', { format: compact.format(count / 1_000) });
  return compact.format(count);
}
