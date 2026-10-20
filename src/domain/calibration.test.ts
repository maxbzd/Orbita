import { describe, expect, it } from 'vitest';
import {
  MIN_CLOSED_PREDICTIONS,
  brierScore,
  calibrationReport,
  reliabilityBuckets,
  toForecasts,
  type Forecast,
} from './calibration';
import type { Prediction } from './types';

const forecast = (probability: number, happened: boolean): Forecast => ({ probability, happened });
const prediction = (probability: number, outcome?: Prediction['outcome']): Pick<Prediction, 'probability' | 'outcome'> => ({
  probability,
  outcome,
});

describe('brierScore', () => {
  it('averages squared errors', () => {
    const score = brierScore([forecast(0.9, true), forecast(0.8, true), forecast(0.3, false)]);
    expect(score).toBeCloseTo((0.01 + 0.04 + 0.09) / 3, 10);
  });

  it('is 0 for certain and right, 0.25 for always 50 %, near 1 for confident and wrong', () => {
    expect(brierScore([forecast(1, true), forecast(0, false)])).toBe(0);
    expect(brierScore([forecast(0.5, true), forecast(0.5, false)])).toBe(0.25);
    expect(brierScore([forecast(0.99, false)])).toBeCloseTo(0.9801, 10);
  });

  it('is null without forecasts', () => {
    expect(brierScore([])).toBeNull();
  });
});

describe('toForecasts', () => {
  it('keeps only predictions that came out true or false', () => {
    const result = toForecasts([
      prediction(0.7, 'true'),
      prediction(0.4, 'false'),
      prediction(0.6, 'unknown'),
      prediction(0.5),
    ]);
    expect(result).toEqual([forecast(0.7, true), forecast(0.4, false)]);
  });
});

describe('reliabilityBuckets', () => {
  it('always returns every bucket, with bounds', () => {
    const buckets = reliabilityBuckets([]);
    expect(buckets).toHaveLength(10);
    expect(buckets[0]).toMatchObject({ index: 0, from: 0, to: 0.1, count: 0, meanProbability: null, observedRate: null });
    expect(buckets[9]).toMatchObject({ from: 0.9, to: 1 });
  });

  it('puts a probability into the bucket it opens, not the one it closes', () => {
    const index = (p: number) => reliabilityBuckets([forecast(p, true)]).findIndex((bucket) => bucket.count === 1);
    expect(index(0.01)).toBe(0);
    expect(index(0.09)).toBe(0);
    expect(index(0.1)).toBe(1);
    expect(index(0.29)).toBe(2);
    expect(index(0.3)).toBe(3);
    expect(index(0.7)).toBe(7);
    expect(index(0.99)).toBe(9);
  });

  it('computes the observed rate per bucket', () => {
    const buckets = reliabilityBuckets([
      forecast(0.7, true),
      forecast(0.72, true),
      forecast(0.78, false),
      forecast(0.75, true),
      forecast(0.2, false),
    ]);
    expect(buckets[7]).toMatchObject({ count: 4, hits: 3, observedRate: 0.75 });
    expect(buckets[7]!.meanProbability).toBeCloseTo((0.7 + 0.72 + 0.78 + 0.75) / 4, 10);
    expect(buckets[2]).toMatchObject({ count: 1, hits: 0, observedRate: 0 });
    expect(buckets[5]).toMatchObject({ count: 0, observedRate: null });
  });

  it('supports another bucket count', () => {
    const buckets = reliabilityBuckets([forecast(0.55, true)], 5);
    expect(buckets).toHaveLength(5);
    expect(buckets[2]).toMatchObject({ count: 1, from: 0.4, to: 0.6 });
  });
});

describe('calibrationReport', () => {
  it('asks for more data under the minimum', () => {
    const report = calibrationReport([prediction(0.7, 'true'), prediction(0.6, 'false'), prediction(0.9, 'true'), prediction(0.5, 'true')]);
    expect(report).toEqual({ enough: false, closed: 4, needed: MIN_CLOSED_PREDICTIONS });
    expect(MIN_CLOSED_PREDICTIONS).toBe(5);
  });

  it('does not count open or unknown predictions towards the minimum', () => {
    const report = calibrationReport([
      prediction(0.7, 'true'),
      prediction(0.6, 'false'),
      prediction(0.9, 'true'),
      prediction(0.5, 'true'),
      prediction(0.5, 'unknown'),
      prediction(0.5),
    ]);
    expect(report).toMatchObject({ enough: false, closed: 4 });
  });

  it('reports from the fifth closed prediction', () => {
    const report = calibrationReport([
      prediction(0.9, 'true'),
      prediction(0.9, 'false'),
      prediction(0.9, 'false'),
      prediction(0.9, 'true'),
      prediction(0.9, 'false'),
    ]);
    if (!report.enough) throw new Error('expected enough data');
    expect(report.closed).toBe(5);
    expect(report.hitRate).toBeCloseTo(0.4, 10);
    expect(report.meanProbability).toBeCloseTo(0.9, 10);
    expect(report.bias).toBeCloseTo(0.5, 10); // said 90 %, got 40 %: overconfident
    expect(report.brier).toBeCloseTo((2 * 0.01 + 3 * 0.81) / 5, 10);
    expect(report.buckets[9]).toMatchObject({ count: 5, hits: 2 });
  });

  it('shows underconfidence as negative bias', () => {
    const report = calibrationReport(Array.from({ length: 5 }, () => prediction(0.3, 'true')));
    if (!report.enough) throw new Error('expected enough data');
    expect(report.bias).toBeCloseTo(-0.7, 10);
  });

  it('honors custom thresholds', () => {
    const closed = [prediction(0.7, 'true'), prediction(0.6, 'false')];
    expect(calibrationReport(closed, { minClosed: 2 })).toMatchObject({ enough: true, closed: 2 });
    expect(calibrationReport([], { minClosed: 0 })).toMatchObject({ enough: false, closed: 0 });
  });
});
