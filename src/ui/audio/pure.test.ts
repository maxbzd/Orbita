import { describe, expect, it } from 'vitest';
import { formatClock, isoDuration, spokenDuration, wholeSeconds } from './format';
import { ACTIVE_WINDOW_SECONDS, MIN_MARKER_GAP, activeMarkerAt, pillSide, placeMarkers } from './lanes';
import type { AudioMarker } from './lanes';
import { pushHistory, staticProfile } from './LevelBars';
import {
  BAR_GAP,
  BAR_WIDTH,
  MIN_BAR,
  barCount,
  barsPath,
  fractionAt,
  layoutBars,
  resamplePeaks,
  sanitizePeaks,
  seekFromKey,
} from './peaks';

describe('formatClock', () => {
  it('pads minutes for a running recording and not for a player', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(134)).toBe('02:14');
    expect(formatClock(134, { pad: false })).toBe('2:14');
    expect(formatClock(59.9)).toBe('00:59');
    expect(formatClock(600)).toBe('10:00');
  });

  it('adds hours for long recordings (a 30-minute walk is fine, an hour needs h:mm:ss)', () => {
    expect(formatClock(1800)).toBe('30:00');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(3600, { pad: false })).toBe('1:00:00');
  });

  it('turns nonsense into zero', () => {
    for (const bad of [-5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatClock(bad)).toBe('00:00');
      expect(wholeSeconds(bad)).toBe(0);
    }
  });
});

describe('spokenDuration', () => {
  it.each([
    [0, '0 секунд'],
    [1, '1 секунда'],
    [2, '2 секунды'],
    [11, '11 секунд'],
    [21, '21 секунда'],
    [60, '1 минута'],
    [134, '2 минуты 14 секунд'],
    [3600, '1 час'],
    [3725, '1 час 2 минуты 5 секунд'],
    [7380, '2 часа 3 минуты'],
  ])('%s s is read as "%s"', (seconds, spoken) => {
    expect(spokenDuration(seconds)).toBe(spoken);
  });
});

describe('isoDuration', () => {
  it.each([
    [0, 'PT0S'],
    [5, 'PT5S'],
    [120, 'PT2M'],
    [134, 'PT2M14S'],
    [3600, 'PT1H'],
    [3725, 'PT1H2M5S'],
  ])('%s s is %s', (seconds, iso) => {
    expect(isoDuration(seconds)).toBe(iso);
  });
});

describe('peaks', () => {
  it('clamps every value to 0..1 and zeroes what is not a number', () => {
    expect(sanitizePeaks([0.2, 5, -1, Number.NaN, Number.POSITIVE_INFINITY])).toEqual([0.2, 1, 0, 0, 0]);
  });

  it('takes the maximum of a slice when there are more peaks than bars', () => {
    expect(resamplePeaks([0.1, 0.9, 0.2, 0.3, 0.4, 0.05], 3)).toEqual([0.9, 0.3, 0.4]);
    expect(resamplePeaks([0.1, 0.9, 0.2], 1)).toEqual([0.9]);
  });

  it('interpolates when there are fewer peaks than bars and keeps both ends', () => {
    const out = resamplePeaks([0, 1], 5);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe(0);
    expect(out[4]).toBe(1);
    expect(out[2]).toBeCloseTo(0.5, 10);
    expect(resamplePeaks([0.7], 3)).toEqual([0.7, 0.7, 0.7]);
  });

  it('gives a flat line for no peaks, nothing for no bars', () => {
    expect(resamplePeaks([], 4)).toEqual([0, 0, 0, 0]);
    expect(resamplePeaks([0.5, 0.5], 0)).toEqual([]);
    expect(resamplePeaks([0.5, 0.5], -3)).toEqual([]);
  });

  it('keeps the loudest moment visible however narrow the screen is', () => {
    const peaks = new Array<number>(180).fill(0.1);
    peaks[97] = 1;
    expect(Math.max(...resamplePeaks(peaks, 40))).toBe(1);
  });

  it('fits bars 2 px wide with a 1 px gap', () => {
    expect(BAR_WIDTH).toBe(2);
    expect(BAR_GAP).toBe(1);
    expect(barCount(320)).toBe(107); // 107 * 3 - 1 = 320
    expect(barCount(358)).toBe(119);
    expect(barCount(2)).toBe(1);
    expect(barCount(1)).toBe(0);
    expect(barCount(0)).toBe(0);
    expect(barCount(Number.NaN)).toBe(0);
  });

  it('lays out bars centred, never shorter than the minimum', () => {
    const bars = layoutBars([0, 1], 10, 56);
    expect(bars).toHaveLength(barCount(10));
    const first = bars[0]!;
    const last = bars[bars.length - 1]!;
    // centred: the space left of the first bar equals the space right of the last
    expect(first.x - BAR_WIDTH / 2).toBeCloseTo(10 - (last.x + BAR_WIDTH / 2), 10);
    expect(first.height).toBe(MIN_BAR);
    expect(last.height).toBe(56);
    expect(layoutBars([1], 0, 56)).toEqual([]);
  });

  it('writes bars as strokes up from the baseline, or down for the mirror', () => {
    const bars = [{ x: 1, height: 10 }, { x: 4, height: 20 }];
    expect(barsPath(bars, 57, -1)).toBe('M1 57V47M4 57V37');
    expect(barsPath(bars, 59, 1, 0.35)).toBe('M1 59V62.5M4 59V66');
    expect(barsPath([], 57, -1)).toBe('');
  });
});

describe('scrubbing maths', () => {
  it('maps a pointer to a fraction and clamps outside the wave', () => {
    expect(fractionAt(150, 50, 200)).toBe(0.5);
    expect(fractionAt(0, 50, 200)).toBe(0);
    expect(fractionAt(999, 50, 200)).toBe(1);
    expect(fractionAt(10, 0, 0)).toBe(0);
  });

  it('steps 5 s per arrow (15 with Shift) when the length is known', () => {
    expect(seekFromKey('ArrowRight', 0.5, 100)).toBeCloseTo(0.55, 10);
    expect(seekFromKey('ArrowLeft', 0.5, 100)).toBeCloseTo(0.45, 10);
    expect(seekFromKey('ArrowRight', 0.5, 100, true)).toBeCloseTo(0.65, 10);
    expect(seekFromKey('ArrowUp', 0.5, 100)).toBeCloseTo(0.55, 10);
    expect(seekFromKey('ArrowDown', 0.5, 100)).toBeCloseTo(0.45, 10);
  });

  it('steps 2 % when the length is unknown', () => {
    expect(seekFromKey('ArrowRight', 0.5, undefined)).toBeCloseTo(0.52, 10);
    expect(seekFromKey('ArrowRight', 0.5, 0)).toBeCloseTo(0.52, 10);
    expect(seekFromKey('ArrowLeft', 0.5, Number.NaN)).toBeCloseTo(0.48, 10);
  });

  it('jumps 10 % with the page keys and to the ends with Home and End', () => {
    expect(seekFromKey('PageUp', 0.5, 100)).toBeCloseTo(0.6, 10);
    expect(seekFromKey('PageDown', 0.5, 100)).toBeCloseTo(0.4, 10);
    expect(seekFromKey('Home', 0.5, 100)).toBe(0);
    expect(seekFromKey('End', 0.5, 100)).toBe(1);
  });

  it('never leaves 0..1, and ignores other keys', () => {
    expect(seekFromKey('ArrowLeft', 0.01, 100)).toBe(0);
    expect(seekFromKey('ArrowRight', 0.99, 100, true)).toBe(1);
    expect(seekFromKey('ArrowRight', 7, 100)).toBe(1);
    expect(seekFromKey('ArrowRight', Number.NaN, 100)).toBeCloseTo(0.05, 10);
    expect(seekFromKey('a', 0.5, 100)).toBeNull();
    expect(seekFromKey(' ', 0.5, 100)).toBeNull();
  });
});

const marker = (id: string, time: number, kind: AudioMarker['kind'] = 'decision'): AudioMarker => ({ id, time, kind, label: id });

describe('placeMarkers', () => {
  it('uses the upper lane while there is room', () => {
    const placed = placeMarkers([marker('a', 10), marker('b', 50)], 100, 300);
    expect(placed.map((p) => p.lane)).toEqual([0, 0]);
    expect(placed.map((p) => p.fraction)).toEqual([0.1, 0.5]);
  });

  it('puts a close neighbour on the lower lane, and goes back up when there is room again', () => {
    const placed = placeMarkers([marker('a', 10), marker('b', 11), marker('c', 40)], 100, 300);
    expect(placed.map((p) => p.lane)).toEqual([0, 1, 0]);
    expect(MIN_MARKER_GAP).toBeGreaterThan(10); // a dot is 10 px wide
  });

  it('sorts by time and keeps every marker even when both lanes are crowded', () => {
    const placed = placeMarkers([marker('c', 12), marker('a', 10), marker('b', 11), marker('d', 11.5)], 100, 300);
    expect(placed.map((p) => p.marker.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(placed).toHaveLength(4);
  });

  it('clamps markers outside the recording and survives a zero length', () => {
    const placed = placeMarkers([marker('a', -3), marker('b', 500)], 100, 300);
    expect(placed.map((p) => p.fraction)).toEqual([0, 1]);
    expect(placeMarkers([marker('a', 3)], 0, 300)[0]?.fraction).toBe(0);
    expect(placeMarkers([], 100, 300)).toEqual([]);
  });
});

describe('activeMarkerAt', () => {
  const list = [marker('a', 10), marker('b', 20), marker('c', 22)];

  it('is the marker the playhead has just passed', () => {
    expect(activeMarkerAt(list, 11)?.id).toBe('a');
    expect(activeMarkerAt(list, 20)?.id).toBe('b');
  });

  it('prefers the latest of several in the window', () => {
    expect(activeMarkerAt(list, 23)?.id).toBe('c');
  });

  it('is none before the first marker and after the window has closed', () => {
    expect(activeMarkerAt(list, 5)).toBeNull();
    expect(activeMarkerAt(list, 10 + ACTIVE_WINDOW_SECONDS + 0.1)).toBeNull();
    expect(activeMarkerAt([], 5)).toBeNull();
  });
});

describe('pillSide', () => {
  it('grows to the right, except near the right edge', () => {
    expect(pillSide(0)).toBe('start');
    expect(pillSide(0.6)).toBe('start');
    expect(pillSide(0.61)).toBe('end');
    expect(pillSide(1)).toBe('end');
  });
});

describe('level bars maths', () => {
  it('draws a static level as a voice: tallest in the middle, silent when the level is zero', () => {
    const bars = staticProfile(5, 1);
    expect(bars[2]).toBeGreaterThan(bars[0]!);
    expect(bars[2]).toBeGreaterThan(bars[4]!);
    expect(Math.max(...bars)).toBeLessThanOrEqual(1);
    expect(staticProfile(4, 0)).toEqual([0, 0, 0, 0]);
    expect(staticProfile(1, 0.5)).toEqual([0.5]);
  });

  it('shifts the history left and pushes the newest level in at the right', () => {
    expect(pushHistory([0, 0.2, 0.4], 0.9)).toEqual([0.2, 0.4, 0.9]);
    expect(pushHistory([], 0.5)).toEqual([]);
  });
});
