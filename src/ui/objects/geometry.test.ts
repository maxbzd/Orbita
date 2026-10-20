import { describe, expect, it } from 'vitest';
import {
  barcodeBars,
  buildMrz,
  daysInMonth,
  firstWeekday,
  fitFontSize,
  fitParagraph,
  monthDots,
  mrzCheckDigit,
  proportionalSweeps,
  starPath,
  starPoints,
  starRadius,
  textWidth,
  wrapLines,
} from './geometry';
import { TAU } from '../viz/polar';

describe('wrapLines', () => {
  it('wraps at word boundaries within the estimated width', () => {
    const { lines, truncated } = wrapLines('Ты чаще всего откладываешь звонки по вечерам', 120, 10, { ratio: 0.5 });
    expect(truncated).toBe(false);
    for (const line of lines) expect(textWidth(line, 10, 0.5)).toBeLessThanOrEqual(120);
    expect(lines.join(' ')).toBe('Ты чаще всего откладываешь звонки по вечерам');
  });

  it('splits a word longer than the line', () => {
    const { lines } = wrapLines('Нейрофизиологический', 60, 10, { ratio: 0.5 });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('Нейрофизиологический');
  });

  it('cuts with an ellipsis when over the line limit', () => {
    const { lines, truncated } = wrapLines('один два три четыре пять шесть семь восемь', 60, 10, { ratio: 0.5, maxLines: 2 });
    expect(truncated).toBe(true);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith('…')).toBe(true);
  });

  it('handles empty text', () => {
    expect(wrapLines('   ', 100, 10)).toEqual({ lines: [], truncated: false });
  });
});

describe('fitParagraph', () => {
  it('uses the biggest size that fits', () => {
    const short = fitParagraph('Коротко.', 200, 200);
    expect(short.fontSize).toBe(24);
    const long = fitParagraph(
      'Ты обещаешь больше, чем успеваешь, особенно в начале недели, когда энергии много, а календарь пуст.',
      170,
      150,
    );
    expect(long.fontSize).toBeLessThan(24);
    expect(long.lines.length * long.fontSize * long.lineHeight).toBeLessThanOrEqual(150 + 0.001);
  });

  it('falls back to the smallest size with an ellipsis', () => {
    const fitted = fitParagraph('слово '.repeat(200), 100, 40);
    expect(fitted.fontSize).toBe(13);
    expect(fitted.truncated).toBe(true);
  });
});

describe('fitFontSize', () => {
  it('shrinks a long month name to the width and respects the limits', () => {
    const wide = fitFontSize('СЕНТЯБРЬ', 320);
    expect(wide).toBeGreaterThanOrEqual(40);
    expect(wide * 8 * 0.9).toBeLessThanOrEqual(320 + 0.5);
    expect(fitFontSize('МАЙ', 320)).toBeGreaterThan(wide);
    expect(fitFontSize('X', 5000, { max: 100 })).toBe(100);
    expect(fitFontSize('X'.repeat(100), 10, { min: 12 })).toBe(12);
  });
});

describe('star', () => {
  it('reaches the outer radius on the rays and the inner one in the valleys', () => {
    expect(starRadius(0)).toBeCloseTo(1, 6);
    expect(starRadius(TAU / 5)).toBeCloseTo(1, 6);
    expect(starRadius(TAU / 10)).toBeCloseTo(0.62, 6);
  });

  it('stays inside the outer circle and is closed', () => {
    const points = starPoints(150, 190, 100);
    expect(points).toHaveLength(180);
    for (const p of points) expect(Math.hypot(p.x - 150, p.y - 190)).toBeLessThanOrEqual(100.0001);
    const path = starPath(150, 190, 100);
    expect(path.startsWith('M')).toBe(true);
    expect(path.endsWith('Z')).toBe(true);
  });

  it('has five rays pointing up for the default rotation', () => {
    const top = starPoints(0, 0, 100)[0]!;
    expect(top.x).toBeCloseTo(0, 6);
    expect(top.y).toBeCloseTo(-100, 6);
  });

  it('rounds the rays more with a smaller plump exponent', () => {
    const near = TAU / 5 / 4;
    expect(starRadius(near, { plump: 0.5 })).toBeGreaterThan(starRadius(near, { plump: 1.2 }));
  });
});

describe('barcodeBars', () => {
  it('is deterministic and fills the width without overlaps', () => {
    const a = barcodeBars('2026-10-08', 70);
    expect(a).toEqual(barcodeBars('2026-10-08', 70));
    expect(a).not.toEqual(barcodeBars('2026-10-09', 70));
    expect(a).toHaveLength(22);
    for (let i = 1; i < a.length; i++) expect(a[i]!.x).toBeGreaterThan(a[i - 1]!.x + a[i - 1]!.width - 0.05);
    const last = a[a.length - 1]!;
    expect(last.x + last.width).toBeCloseTo(70, 0);
  });
});

describe('MRZ', () => {
  it('matches the ICAO check digit examples', () => {
    expect(mrzCheckDigit('520727')).toBe(3);
    expect(mrzCheckDigit('L898902C3')).toBe(6);
  });

  it('builds two 44-character lines of allowed characters from real numbers', () => {
    const [a, b] = buildMrz({ year: 2026, hero: 412, stats: [37, 120, 9, 64], issuedOn: '2026-12-31' });
    expect(a).toHaveLength(44);
    expect(b).toHaveLength(44);
    expect(a).toMatch(/^[A-Z0-9<]+$/);
    expect(b).toMatch(/^[A-Z0-9<]+$/);
    expect(a).toContain('00412');
    expect(b).toContain('00037');
    expect(b).toContain('261231');
    expect(buildMrz({ year: 2026, hero: 412, stats: [37, 120, 9, 64], issuedOn: '2026-12-31' })).toEqual([a, b]);
  });

  it('clamps absurd numbers instead of overflowing the field', () => {
    const [a] = buildMrz({ year: 2026, hero: 10 ** 9, stats: [], issuedOn: '2026-01-01' });
    expect(a).toHaveLength(44);
    expect(a).toContain('99999');
  });
});

describe('month dots', () => {
  it('knows month lengths and weekdays (Monday-first)', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 10)).toBe(31);
    expect(firstWeekday(2026, 10)).toBe(3); // Thursday
    expect(firstWeekday(2026, 6)).toBe(0); // Monday
  });

  it('places a dot per day with its mood', () => {
    const dots = monthDots(2026, 10, [2, null, -1]);
    expect(dots).toHaveLength(31);
    expect(dots[0]).toEqual({ day: 1, col: 3, row: 0, mood: 2 });
    expect(dots[1]!.mood).toBeNull();
    expect(dots[2]!.mood).toBe(-1);
    expect(dots[3]!.mood).toBeNull();
    expect(dots[4]).toMatchObject({ day: 5, col: 0, row: 1 });
  });
});

describe('proportionalSweeps', () => {
  it('gives the largest value the full sweep and the rest in proportion', () => {
    const s = proportionalSweeps([100, 50, 0, 25], 6);
    expect(s[0]).toBeCloseTo(6);
    expect(s[1]).toBeCloseTo(3);
    expect(s[2]).toBe(0);
    expect(s[3]).toBeCloseTo(1.5);
  });

  it('keeps small positive values visible and ignores junk', () => {
    expect(proportionalSweeps([1000, 1], 6, 0.12)[1]).toBeCloseTo(0.12);
    expect(proportionalSweeps([NaN, -4, 0])).toEqual([0, 0, 0]);
    expect(proportionalSweeps([])).toEqual([]);
  });
});
