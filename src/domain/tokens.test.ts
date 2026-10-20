import { describe, expect, it } from 'vitest';
import { estimateTokens, formatTokens } from './tokens';

describe('estimateTokens', () => {
  it('is 0 for empty text and whitespace', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(' \n\t ')).toBe(0);
  });

  it('is in a sane range for short phrases', () => {
    expect(estimateTokens('Привет, мир')).toBeGreaterThanOrEqual(4);
    expect(estimateTokens('Привет, мир')).toBeLessThanOrEqual(8);
    expect(estimateTokens('Hello, world')).toBeGreaterThanOrEqual(3);
    expect(estimateTokens('Hello, world')).toBeLessThanOrEqual(6);
  });

  it('charges Russian more per character than English', () => {
    const russian = 'а'.repeat(400);
    const english = 'a'.repeat(400);
    expect(estimateTokens(russian)).toBe(160);
    expect(estimateTokens(english)).toBe(100);
  });

  it('counts digits, punctuation and other scripts', () => {
    expect(estimateTokens('2026')).toBe(2);
    expect(estimateTokens('!!!!')).toBe(3);
    expect(estimateTokens('日本語')).toBe(5);
  });

  it('grows with the text', () => {
    const sentence = 'Сегодня договорился с родителем о тестовом уроке на пятницу. ';
    expect(estimateTokens(sentence.repeat(10))).toBeGreaterThan(estimateTokens(sentence.repeat(5)));
  });
});

describe('formatTokens', () => {
  it('abbreviates thousands and millions in Russian', () => {
    expect(formatTokens(980)).toBe('980');
    expect(formatTokens(1000)).toBe('1 тыс.');
    expect(formatTokens(12_340)).toBe('12,3 тыс.');
    expect(formatTokens(1_200_000)).toBe('1,2 млн');
  });
});
