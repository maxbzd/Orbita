import { describe, expect, it } from 'vitest';
import { locateQuote } from './quotes';

const TEXT = 'Сегодня гулял.\nРешил поднять цену на тестовое, потому что   бесплатные  приходят и пропадают. Ну вот, Ёлка упала!';

describe('locateQuote', () => {
  it('finds an exact quote and its offset', () => {
    const found = locateQuote(TEXT, 'поднять цену на тестовое');
    expect(found).toEqual({ quote: 'поднять цену на тестовое', start: TEXT.indexOf('поднять') });
  });

  it('survives changed case, ё/е, line breaks and collapsed whitespace, returning the original wording', () => {
    const found = locateQuote(TEXT, 'ПОТОМУ ЧТО бесплатные приходят');
    expect(found?.quote).toBe('потому что   бесплатные  приходят');
    expect(found?.start).toBe(TEXT.indexOf('потому'));
    expect(locateQuote(TEXT, 'елка упала')?.quote).toBe('Ёлка упала');
    expect(locateQuote(TEXT, 'гулял. Решил поднять')?.quote).toBe('гулял.\nРешил поднять');
  });

  it('survives changed punctuation', () => {
    expect(locateQuote(TEXT, 'Ну вот Ёлка упала')?.quote).toBe('Ну вот, Ёлка упала');
    expect(locateQuote(TEXT, 'приходят, и пропадают')?.quote).toBe('приходят и пропадают');
  });

  it('strips quotation marks and ellipses the model added', () => {
    expect(locateQuote(TEXT, '«…поднять цену на тестовое…»')?.quote).toBe('поднять цену на тестовое');
    expect(locateQuote(TEXT, '"поднять цену..."')?.quote).toBe('поднять цену');
  });

  it('does not invent: missing, reworded, too short or empty quotes give nothing', () => {
    expect(locateQuote(TEXT, 'повысить стоимость тестового занятия')).toBeUndefined();
    expect(locateQuote(TEXT, 'да')).toBeUndefined();
    expect(locateQuote(TEXT, '')).toBeUndefined();
    expect(locateQuote(TEXT, null)).toBeUndefined();
    expect(locateQuote(TEXT, undefined)).toBeUndefined();
    expect(locateQuote('', 'что-нибудь длинное')).toBeUndefined();
  });

  it('keeps offsets right in text with emoji and combining characters before the quote', () => {
    const text = '😀😀 Надо позвонить Маше завтра';
    const found = locateQuote(text, 'надо позвонить маше');
    expect(found).toEqual({ quote: 'Надо позвонить Маше', start: text.indexOf('Надо') });
    expect(text.slice(found?.start, (found?.start ?? 0) + (found?.quote.length ?? 0))).toBe(found?.quote);
  });
});
