import type { Query } from 'minisearch';
import { termsOf } from './tokenize';

/**
 * Function words that carry no meaning of their own. They are dropped from a query of several
 * words («что я решил про цены» → «решил цены»), never from a query made only of them.
 * Kept short on purpose: «сказал», «надо», «много» are real search words in a life log.
 */
// i18n-ignore-start: language data, not UI text
const STOP_WORDS: ReadonlySet<string> = new Set([
  'and', 'or', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'about', 'from', 'by', 'is', 'are', 'was', 'were', 'be',
  'it', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'you', 'he', 'she', 'they', 'what', 'who', 'when', 'where', 'how',
  'why', 'did', 'do', 'does', 'have', 'has', 'had', 'there', 'here', 'than', 'then', 'so', 'if', 'but', 'not', 'no',
  'и', 'в', 'во', 'на', 'с', 'со', 'к', 'ко', 'у', 'о', 'об', 'обо', 'от', 'до', 'из', 'за', 'по', 'под', 'над', 'при',
  'про', 'для', 'без', 'через', 'между', 'не', 'ни', 'но', 'а', 'да', 'или', 'ли', 'бы', 'же', 'то', 'что', 'как', 'так',
  'это', 'этот', 'эта', 'эти', 'вот', 'ну', 'уж', 'еще', 'уже', 'я', 'мы', 'ты', 'вы', 'он', 'она', 'оно', 'они', 'мне',
  'меня', 'мой', 'моя', 'мое', 'мои', 'его', 'ее', 'их', 'кто', 'чем', 'когда', 'где', 'куда', 'там', 'тут',
]);
// i18n-ignore-end

/**
 * Perfective prefixes of Russian verbs: «обещал» ↔ «пообещал», «делал» ↔ «сделал», «писал» ↔ «записал».
 * Instead of stemming, a query word is also tried with and without them (see `termVariants`).
 */
// i18n-ignore-next
const VERB_PREFIXES = ['по', 'за', 'на', 'при', 'вы', 'пере', 'под', 'от', 'до', 'про', 'об', 'с', 'у', 'раз', 'рас'] as const;

/** Words shorter than this are never extended or stripped: «ход» → «приход» is another word. */
const MIN_VARIANT_LENGTH = 4;

/** Derived forms count for less than what the user actually typed. */
const VARIANT_BOOST = 0.6;

/** Distinct normalized words of a query, in order; stop words removed when something else is left. */
export function queryTerms(query: string): string[] {
  const unique = [...new Set(termsOf(query))];
  const meaningful = unique.filter((term) => !STOP_WORDS.has(term));
  return meaningful.length > 0 ? meaningful : unique;
}

/** Forms of a word under a verb prefix and without one, never the word itself. */
export function termVariants(term: string): string[] {
  // Russian prefixes only make sense on Cyrillic words.
  if (term.length < MIN_VARIANT_LENGTH || !/[а-яё]/.test(term)) return [];
  const variants = new Set<string>();
  for (const prefix of VERB_PREFIXES) {
    variants.add(prefix + term);
    if (term.startsWith(prefix) && term.length - prefix.length >= MIN_VARIANT_LENGTH) {
      variants.add(term.slice(prefix.length));
    }
  }
  variants.delete(term);
  return [...variants];
}

/**
 * Edits tolerated in a word of this length: none in one- and two-letter words, one up to five
 * letters («Маше» → «Маша», «Оле» → «Оля»), two from six («задача» → «задачей»).
 */
export function fuzzyDistance(length: number): number {
  if (length <= 2) return 0;
  return length <= 5 ? 1 : 2;
}

export interface QueryShape {
  combine: 'and' | 'or';
  prefix: boolean;
  fuzzy: boolean;
}

/**
 * MiniSearch expression tree: the words are combined with AND/OR; each word is itself an OR of
 * the word as typed (prefix + typos) and its verb-prefix variants (prefix only, lower weight).
 */
export function buildQuery(terms: readonly string[], { combine, prefix, fuzzy }: QueryShape): Query {
  const wordQuery = (term: string): Query => {
    const typed: Query = {
      queries: [term],
      prefix,
      fuzzy: fuzzy ? fuzzyDistance(term.length) : false,
    };
    const variants = termVariants(term);
    if (variants.length === 0) return typed;
    const derived: Query = { queries: variants, prefix, fuzzy: false, boostTerm: () => VARIANT_BOOST };
    return { combineWith: 'OR', queries: [typed, derived] };
  };
  return { combineWith: combine === 'and' ? 'AND' : 'OR', queries: terms.map(wordQuery) };
}
