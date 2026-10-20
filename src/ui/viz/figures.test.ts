import { describe, expect, it } from 'vitest';
import { averageMood, describeCell, monthDayKeys, monthGridCell, relationOf, weekDayKeys } from './calendar';
import { heatGrid, heatLevel, monthLabels } from './heatGrid';
import { axisPosition, hashString, initials, nameHue } from './PeopleLines';
import { sparklineGeometry } from './Sparkline';
import { cursorAngle, weekDotRadius } from './WeekOrbit';
import { YEAR_CELL, YEAR_VIEW_H, YEAR_VIEW_W, monthOrigin, shiftMonthIndex, yearCellCenter } from './yearLayout';
import { spanAngles } from './DayDisk';
import { eachDay } from '../../domain/dates';
import { TAU } from './polar';

describe('calendar helpers', () => {
  it('lists the days of a month, leap years included', () => {
    expect(monthDayKeys('2026-10')).toHaveLength(31);
    expect(monthDayKeys('2026-02')).toHaveLength(28);
    expect(monthDayKeys('2028-02')).toHaveLength(29);
    expect(monthDayKeys('2026-10')[0]).toBe('2026-10-01');
  });

  it('lists a Monday-first week', () => {
    const week = weekDayKeys('2026-10-07'); // a Wednesday
    expect(week[0]).toBe('2026-10-05');
    expect(week[6]).toBe('2026-10-11');
  });

  it('classifies days against today', () => {
    expect(relationOf('2026-10-06', '2026-10-07')).toBe('past');
    expect(relationOf('2026-10-07', '2026-10-07')).toBe('today');
    expect(relationOf('2026-10-08', '2026-10-07')).toBe('future');
    expect(relationOf('2030-01-01', null)).toBe('past');
  });

  it('places days in a Monday-first grid', () => {
    expect(monthGridCell('2026-10-01')).toEqual({ col: 3, row: 0 }); // Thursday
    expect(monthGridCell('2026-10-05')).toEqual({ col: 0, row: 1 });
    expect(monthGridCell('2026-10-31')).toEqual({ col: 5, row: 4 });
  });

  it('describes a cell for a screen reader', () => {
    const text = describeCell('2026-10-07', { date: '2026-10-07', mood: 2, count: 3 }, 'today');
    expect(text).toContain('среда');
    expect(text).toContain('сегодня');
    expect(text).toContain('Приятно');
    expect(text).toContain('3 записи');
    expect(describeCell('2026-10-06', undefined, 'past')).toContain('записей нет');
    expect(describeCell('2026-10-09', undefined, 'future')).not.toContain('записей нет');
  });

  it('averages only the days that have a mood', () => {
    expect(averageMood([{ date: 'a', mood: 2 }, { date: 'b', mood: -1 }, { date: 'c' }, { date: 'd', mood: null }])).toBe(0.5);
    expect(averageMood([])).toBeNull();
  });
});

describe('year sky layout', () => {
  it('lays twelve months in 3 columns and 4 rows inside the box', () => {
    for (let m = 0; m < 12; m++) {
      const { x, y } = monthOrigin(m);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + YEAR_CELL * 7).toBeLessThanOrEqual(YEAR_VIEW_W);
      expect(y + 20 + YEAR_CELL * 6).toBeLessThanOrEqual(YEAR_VIEW_H);
    }
    expect(monthOrigin(0).y).toBe(monthOrigin(2).y);
    expect(monthOrigin(3).y).toBeGreaterThan(monthOrigin(0).y);
  });

  it('gives every day of the year its own cell centre', () => {
    const seen = new Set<string>();
    for (const day of eachDay('2026-01-01', '2026-12-31')) {
      const { x, y } = yearCellCenter(day);
      seen.add(`${x}:${y}`);
    }
    expect(seen.size).toBe(365);
  });

  it('puts a week in a row and the next week one row down', () => {
    const mon = yearCellCenter('2026-10-05');
    const sun = yearCellCenter('2026-10-11');
    const next = yearCellCenter('2026-10-12');
    expect(sun.y).toBe(mon.y);
    expect(sun.x - mon.x).toBe(YEAR_CELL * 6);
    expect(next.y - mon.y).toBe(YEAR_CELL);
    expect(next.x).toBe(mon.x);
  });

  it('jumps a month for PageUp / PageDown and clamps at the ends', () => {
    const keys = eachDay('2026-01-01', '2026-12-31');
    const i = keys.indexOf('2026-10-07');
    expect(keys[shiftMonthIndex(keys, i, 1)]).toBe('2026-11-07');
    expect(keys[shiftMonthIndex(keys, i, -1)]).toBe('2026-09-07');
    expect(shiftMonthIndex(keys, keys.indexOf('2026-12-20'), 1)).toBe(keys.length - 1);
    expect(shiftMonthIndex(keys, 3, -1)).toBe(0);
  });
});

describe('week orbit', () => {
  it('grows the dot with the number of records, to a cap', () => {
    expect(weekDotRadius(0)).toBe(8);
    expect(weekDotRadius(3)).toBe(12.5);
    expect(weekDotRadius(99)).toBe(17);
    expect(weekDotRadius(undefined)).toBe(8);
  });

  it('places the time cursor inside the day slot', () => {
    // noon on Monday sits on the Monday dot (slot centre = 0)
    expect(cursorAngle(0, 720)).toBeCloseTo(0);
    // noon on Wednesday sits on the third dot
    expect(cursorAngle(2, 720)).toBeCloseTo((2 / 7) * TAU);
    // the start of Monday is half a slot before the Monday dot
    expect(cursorAngle(0, 0)).toBeCloseTo(-TAU / 14);
  });
});

describe('day disk spans', () => {
  it('widens a tiny span to a visible minimum and keeps big ones', () => {
    const [a0, a1] = spanAngles(600, 600);
    expect(a1 - a0).toBeGreaterThanOrEqual(0.044 - 1e-9);
    const [b0, b1] = spanAngles(540, 600);
    expect(b1 - b0).toBeCloseTo((60 / 1440) * TAU);
  });

  it('accepts a reversed span', () => {
    expect(spanAngles(600, 540)).toEqual(spanAngles(540, 600));
  });
});

describe('sparklineGeometry', () => {
  it('draws one line and one area for a series', () => {
    const g = sparklineGeometry([1, 3, 2, 5], 100, 30);
    expect(g.line.startsWith('M')).toBe(true);
    expect(g.area.endsWith('Z')).toBe(true);
    expect(g.min).toBe(1);
    expect(g.max).toBe(5);
    expect(g.last).not.toBeNull();
  });

  it('puts the maximum at the top and the minimum at the bottom', () => {
    const g = sparklineGeometry([0, 10], 100, 30, 3);
    expect(g.last!.y).toBeCloseTo(3);
    expect(g.line).toContain('M3.0 27.0');
  });

  it('breaks the line at gaps', () => {
    const g = sparklineGeometry([1, 2, null, 3, 4], 100, 30);
    expect(g.line.match(/M/g)).toHaveLength(2);
  });

  it('draws a single value as a dot only and a flat series along the middle', () => {
    const single = sparklineGeometry([4], 100, 30);
    expect(single.line).toBe('');
    expect(single.last).not.toBeNull();
    const flat = sparklineGeometry([2, 2, 2], 100, 30);
    expect(flat.last!.y).toBe(15);
  });

  it('handles an empty series and a fixed domain', () => {
    expect(sparklineGeometry([], 100, 30)).toMatchObject({ line: '', area: '', last: null });
    const g = sparklineGeometry([5, 5], 100, 30, 3, [0, 10]);
    expect(g.last!.y).toBeCloseTo(15);
  });
});

describe('heat grid', () => {
  it('uses Monday-first columns', () => {
    const cells = heatGrid('2026-10-01', '2026-10-14'); // Thursday .. next Wednesday
    expect(cells[0]).toEqual({ date: '2026-10-01', col: 0, row: 3 });
    expect(cells.find((c) => c.date === '2026-10-05')).toMatchObject({ col: 1, row: 0 });
    expect(cells.find((c) => c.date === '2026-10-14')).toMatchObject({ col: 2, row: 2 });
    expect(cells).toHaveLength(14);
  });

  it('is empty for a reversed range', () => {
    expect(heatGrid('2026-10-05', '2026-10-01')).toEqual([]);
  });

  it('buckets values in four levels', () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(3, 10)).toBe(2);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(6, 10)).toBe(3);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(99, 10)).toBe(4);
    expect(heatLevel(3, 0)).toBe(0);
  });

  it('labels the months without overlapping', () => {
    const labels = monthLabels(heatGrid('2026-09-01', '2026-12-31'));
    expect(labels.map((l) => l.month)).toEqual([8, 9, 10, 11]);
    for (let i = 1; i < labels.length; i++) expect(labels[i]!.col - labels[i - 1]!.col).toBeGreaterThanOrEqual(3);
  });
});

describe('people lines helpers', () => {
  it('maps a time onto the shared axis, clamped', () => {
    expect(axisPosition(50, 0, 100)).toBe(0.5);
    expect(axisPosition(-5, 0, 100)).toBe(0);
    expect(axisPosition(500, 0, 100)).toBe(1);
    expect(axisPosition(5, 10, 10)).toBe(0);
  });

  it('takes initials from the first two words', () => {
    expect(initials('Анна Петрова')).toBe('АП');
    expect(initials('маша')).toBe('М');
    expect(initials('  ')).toBe('?');
  });

  it('gives the same tint to the same name, whatever the case', () => {
    expect(nameHue('Анна')).toBe(nameHue(' анна '));
    expect(nameHue('Анна')).not.toBe(nameHue('Борис'));
    expect(nameHue('Анна')).toBeLessThan(360);
    expect(hashString('x')).toBe(hashString('x'));
  });
});
