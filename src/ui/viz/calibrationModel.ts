import { MIN_CLOSED_PREDICTIONS, DEFAULT_BUCKET_COUNT, brierScore, reliabilityBuckets } from '../../domain/calibration';
import type { Forecast } from '../../domain/calibration';
import { t } from '../../i18n';

/** Plot area of the reliability chart inside its 300 × 300 box. */
export const PLOT = { left: 44, right: 284, top: 16, bottom: 256 } as const;
export const PLOT_SIZE = PLOT.right - PLOT.left;

export interface ChartBucket {
  index: number;
  /** Bucket bounds as fractions. */
  from: number;
  to: number;
  count: number;
  hits: number;
  /** Mean stated probability (x) and the share that came true (y). */
  mean: number;
  observed: number;
  /** Position in the plot, in viewBox units. */
  x: number;
  y: number;
  /** Dot radius: 4 for one forecast up to 12 for the busiest bucket. */
  r: number;
}

export type CalibrationModel =
  | { enough: false; closed: number; needed: number }
  | { enough: true; closed: number; brier: number; buckets: ChartBucket[]; hitRate: number; meanProbability: number };

export function plotX(probability: number): number {
  return PLOT.left + Math.min(1, Math.max(0, probability)) * PLOT_SIZE;
}

export function plotY(rate: number): number {
  return PLOT.bottom - Math.min(1, Math.max(0, rate)) * PLOT_SIZE;
}

/**
 * The numbers behind the reliability chart: buckets of stated probability against the share that
 * came true, and the Brier score. Fewer than `minClosed` scored forecasts give "not enough data",
 * never a chart (a calibration curve from three points would only mislead).
 */
export function buildCalibrationModel(forecasts: readonly Forecast[], { minClosed = MIN_CLOSED_PREDICTIONS, bucketCount = DEFAULT_BUCKET_COUNT }: { minClosed?: number; bucketCount?: number } = {}): CalibrationModel {
  if (forecasts.length < minClosed || forecasts.length === 0) {
    return { enough: false, closed: forecasts.length, needed: minClosed };
  }
  const raw = reliabilityBuckets(forecasts, bucketCount).filter((b) => b.count > 0);
  const busiest = Math.max(1, ...raw.map((b) => b.count));
  const buckets: ChartBucket[] = raw.map((b) => ({
    index: b.index,
    from: b.from,
    to: b.to,
    count: b.count,
    hits: b.hits,
    mean: b.meanProbability!,
    observed: b.observedRate!,
    x: plotX(b.meanProbability!),
    y: plotY(b.observedRate!),
    r: 4 + 8 * Math.sqrt(b.count / busiest),
  }));
  const hits = forecasts.filter((f) => f.happened).length;
  return {
    enough: true,
    closed: forecasts.length,
    brier: brierScore(forecasts)!,
    buckets,
    hitRate: hits / forecasts.length,
    meanProbability: forecasts.reduce((sum, f) => sum + f.probability, 0) / forecasts.length,
  };
}

/** "70–80 %: сбылось 5 из 7 (71 %)" */
export function describeBucket(bucket: Pick<ChartBucket, 'from' | 'to' | 'hits' | 'count' | 'observed'>): string {
  return t('{round}–{round2} %: {hits} of {count} came true ({round3} %)', { round: Math.round(bucket.from * 100), round2: Math.round(bucket.to * 100), hits: bucket.hits, count: bucket.count, round3: Math.round(bucket.observed * 100) });
}
