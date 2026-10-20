/**
 * Evidence quotes. The model is told to copy a fragment of the record verbatim, but models reflow
 * whitespace, change case, drop punctuation or add ellipses. `locateQuote` finds where the fragment
 * really is and returns it exactly as written in the record, so the highlight and the stored quote are
 * always true to the source. A quote that cannot be found is not stored (it would be an invention).
 */

export interface LocatedQuote {
  /** The fragment as it appears in the record text. */
  quote: string;
  /** Offset of the fragment in the record text. */
  start: number;
}

const MIN_QUOTE_LENGTH = 3;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

interface Folded {
  text: string;
  /** For every character of `text`, the index of its source character. */
  origin: number[];
}

/** Lower case, `ё`→`е`, whitespace (and, optionally, punctuation) collapsed into single spaces. */
function fold(source: string, dropPunctuation: boolean): Folded {
  let text = '';
  const origin: number[] = [];
  for (let index = 0; index < source.length; index++) {
    const lowered = source[index].toLowerCase().replace(/ё/g, 'е');
    for (const char of lowered) {
      const isSpace = /\s/.test(char) || (dropPunctuation && !LETTER_OR_DIGIT.test(char));
      if (isSpace) {
        if (text !== '' && !text.endsWith(' ')) {
          text += ' ';
          origin.push(index);
        }
      } else {
        text += char;
        origin.push(index);
      }
    }
  }
  return { text, origin };
}

/** Strips what models add around a quote: quotation marks and ellipses. */
function cleanQuote(quote: string): string {
  return quote
    .trim()
    .replace(/^[«»"'“”„‘’\s]+|[«»"'“”„‘’\s]+$/g, '')
    .replace(/^(?:\.{2,}|…)\s*|\s*(?:\.{2,}|…)$/g, '')
    .trim();
}

function search(text: string, quote: string, dropPunctuation: boolean): LocatedQuote | undefined {
  const haystack = fold(text, dropPunctuation);
  const needle = fold(quote, dropPunctuation).text.trim();
  if (needle.length < MIN_QUOTE_LENGTH) return undefined;
  const at = haystack.text.indexOf(needle);
  if (at === -1) return undefined;
  const start = haystack.origin[at];
  const end = haystack.origin[at + needle.length - 1] + 1;
  return { quote: text.slice(start, end), start };
}

export function locateQuote(text: string, rawQuote: string | null | undefined): LocatedQuote | undefined {
  if (!rawQuote) return undefined;
  const quote = cleanQuote(rawQuote);
  if (quote.length < MIN_QUOTE_LENGTH) return undefined;
  const exact = text.indexOf(quote);
  if (exact !== -1) return { quote, start: exact };
  return search(text, quote, false) ?? search(text, quote, true);
}
