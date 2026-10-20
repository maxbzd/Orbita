import { describe, expect, it } from 'vitest';
import { PLOT, buildCalibrationModel, describeBucket, plotX, plotY } from './calibrationModel';

const f = (probability: number, happened: boolean) => ({ probability, happened });

describe('buildCalibrationModel', () => {
  it('says "not enough data" under five closed predictions', () => {
    const model = buildCalibrationModel([f(0.7, true), f(0.6, false), f(0.9, true), f(0.5, true)]);
    expect(model).toEqual({ enough: false, closed: 4, needed: 5 });
    expect(buildCalibrationModel([])).toEqual({ enough: false, closed: 0, needed: 5 });
  });

  it('computes the Brier score as the mean squared error', () => {
    // errors: 0.1², 0.2², 0.3², 0.4², 0.5² -> mean 0.11
    const forecasts = [f(0.9, true), f(0.8, true), f(0.7, true), f(0.6, true), f(0.5, true)];
    const model = buildCalibrationModel(forecasts);
    expect(model.enough).toBe(true);
    if (model.enough) expect(model.brier).toBeCloseTo((0.01 + 0.04 + 0.09 + 0.16 + 0.25) / 5, 9);
  });

  it('gives 0 for perfect forecasts and 0.25 for "always 50 %"', () => {
    const perfect = buildCalibrationModel([f(1, true), f(1, true), f(0, false), f(0, false), f(1, true)]);
    const coin = buildCalibrationModel([f(0.5, true), f(0.5, false), f(0.5, true), f(0.5, false), f(0.5, true)]);
    if (perfect.enough) expect(perfect.brier).toBe(0);
    if (coin.enough) expect(coin.brier).toBeCloseTo(0.25, 9);
  });

  it('puts forecasts into ten buckets, keeps only the filled ones, and plots mean vs. observed', () => {
    const forecasts = [f(0.72, true), f(0.75, true), f(0.78, false), f(0.15, false), f(0.12, false), f(0.95, true)];
    const model = buildCalibrationModel(forecasts);
    expect(model.enough).toBe(true);
    if (!model.enough) return;
    expect(model.buckets.map((b) => b.index)).toEqual([1, 7, 9]);
    const seventies = model.buckets.find((b) => b.index === 7)!;
    expect(seventies).toMatchObject({ count: 3, hits: 2, from: 0.7, to: 0.8 });
    expect(seventies.mean).toBeCloseTo((0.72 + 0.75 + 0.78) / 3);
    expect(seventies.observed).toBeCloseTo(2 / 3);
    expect(seventies.x).toBeCloseTo(plotX(seventies.mean));
    expect(seventies.y).toBeCloseTo(plotY(2 / 3));
    // the busiest bucket has the biggest dot
    expect(seventies.r).toBe(12);
    expect(model.buckets.find((b) => b.index === 9)!.r).toBeLessThan(seventies.r);
  });

  it('honours a custom threshold and bucket count', () => {
    const forecasts = [f(0.2, false), f(0.8, true), f(0.6, true)];
    expect(buildCalibrationModel(forecasts).enough).toBe(false);
    const model = buildCalibrationModel(forecasts, { minClosed: 3, bucketCount: 2 });
    expect(model.enough).toBe(true);
    if (model.enough) expect(model.buckets.map((b) => b.count)).toEqual([1, 2]);
  });

  it('reports the hit rate and mean stated probability', () => {
    const model = buildCalibrationModel([f(0.9, true), f(0.9, true), f(0.9, false), f(0.9, true), f(0.9, true)]);
    if (model.enough) {
      expect(model.hitRate).toBeCloseTo(0.8);
      expect(model.meanProbability).toBeCloseTo(0.9);
    }
  });
});

describe('plot mapping', () => {
  it('maps 0…1 onto the plot box, y upwards', () => {
    expect(plotX(0)).toBe(PLOT.left);
    expect(plotX(1)).toBe(PLOT.right);
    expect(plotY(0)).toBe(PLOT.bottom);
    expect(plotY(1)).toBe(PLOT.top);
    expect(plotX(2)).toBe(PLOT.right);
    expect(plotY(-1)).toBe(PLOT.bottom);
  });

  it('describes a bucket in words', () => {
    expect(describeBucket({ from: 0.7, to: 0.8, hits: 5, count: 7, observed: 5 / 7 })).toBe('70–80 %: сбылось 5 из 7 (71 %)');
  });
});
