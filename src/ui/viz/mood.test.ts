import { describe, expect, it } from 'vitest';
import { loadThemes } from '../../styles/cssTokens';
import { MOOD_HEX, MOOD_INK_DARK, MOOD_INK_LIGHT, MOOD_STEPS, MOOD_TOKEN, contrastRatio, moodHex, moodInk, moodSpoken, moodStep, moodVar, moodWord } from './mood';

describe('mood scale', () => {
  it('keeps the hex table equal to the stylesheet tokens in both themes', () => {
    const themes = loadThemes();
    for (const step of MOOD_STEPS) {
      for (const theme of [themes.night, themes.dawn]) {
        const [r, g, b] = theme.color(MOOD_TOKEN[step]);
        const hex = `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
        expect(hex).toBe(MOOD_HEX[step]);
      }
    }
  });

  it('rounds to the nearest step, away from zero on halves', () => {
    expect(moodStep(0.49)).toBe(0);
    expect(moodStep(0.5)).toBe(1);
    expect(moodStep(-0.5)).toBe(-1);
    expect(moodStep(2.4)).toBe(2);
    expect(moodStep(9)).toBe(3);
    expect(moodStep(-9)).toBe(-3);
    expect(moodStep(Number.NaN)).toBe(0);
  });

  it('has a word and a spoken form for every step', () => {
    expect(moodWord(2)).toBe('Приятно');
    expect(moodWord(1)).toBe('Спокойно');
    expect(moodSpoken(2)).toBe('Приятно, +2');
    expect(moodSpoken(-1)).toBe('Не очень, -1');
    expect(moodSpoken(0)).toBe('Ровно, 0');
  });

  it('references the nearest step token', () => {
    expect(moodVar(-3)).toBe('var(--m-n3)');
    expect(moodVar(0.2)).toBe('var(--m-0)');
    expect(moodVar(2.9)).toBe('var(--m-p3)');
  });

  it('interpolates between neighbouring steps and hits the steps exactly', () => {
    for (const step of MOOD_STEPS) expect(moodHex(step)).toBe(MOOD_HEX[step]);
    const between = moodHex(0.5);
    expect(between).not.toBe(MOOD_HEX[0]);
    expect(between).not.toBe(MOOD_HEX[1]);
  });

  it('picks a text colour that is readable (large text, 3:1) on every mood fill', () => {
    for (const step of MOOD_STEPS) {
      const ink = moodInk(step);
      expect([MOOD_INK_DARK, MOOD_INK_LIGHT]).toContain(ink);
      expect(contrastRatio(ink, moodHex(step))).toBeGreaterThanOrEqual(3);
    }
  });
});
