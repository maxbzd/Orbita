import type { Prediction } from './types';

/** Calibration is shown from this many closed predictions, otherwise "мало данных". */
export const MIN_CLOSED_PREDICTIONS = 5;
export const DEFAULT_BUCKET_COUNT = 10;

/** A closed prediction reduced to what calibration needs. */
export interface Forecast {
  /** Probability stated at the time of recording, 0..1. */
  probability: number;
  happened: boolean;
}

export interface ReliabilityBucket {
  index: number;
  /** Bucket bounds as fractions: 0.7..0.8 is the "70–80 %" bucket. */
  from: number;
  to: number;
  count: number;
  hits: number;
  /** Average stated probability in the bucket; null when empty. */
  meanProbability: number | null;
  /** Share that came true; null when empty. */
  observedRate: number | null;
}

export type CalibrationReport =
  | { enough: false; closed: number; needed: number }
  | {
      enough: true;
      closed: number;
      /** mean((p − outcome)²): 0 is perfect, 0.25 is "always say 50 %". */
      brier: number;
      meanProbability: number;
      hitRate: number;
      /** meanProbability − hitRate: above 0 means overconfidence in "yes". */
      bias: number;
      buckets: ReliabilityBucket[];
    };

/** Keeps only predictions that came out `true` or `false` (`unknown` and open ones are not scored). */
export function toForecasts(predictions: readonly Pick<Prediction, 'probability' | 'outcome'>[]): Forecast[] {
  const forecasts: Forecast[] = [];
  for (const { probability, outcome } of predictions) {
    if (outcome === 'true' || outcome === 'false') forecasts.push({ probability, happened: outcome === 'true' });
  }
  return forecasts;
}

const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;

const squaredError = ({ probability, happened }: Forecast): number => (probability - (happened ? 1 : 0)) ** 2;

/** Brier score, or null without forecasts. */
export function brierScore(forecasts: readonly Forecast[]): number | null {
  return forecasts.length === 0 ? null : mean(forecasts.map(squaredError));
}

/** Bucket for a probability; the rounding keeps 0.3, 0.7 … on the intended side of the edge. */
function bucketIndex(probability: number, bucketCount: number): number {
  const scaled = Math.floor(Math.round(probability * bucketCount * 1e6) / 1e6);
  return Math.min(bucketCount - 1, Math.max(0, scaled));
}

export function reliabilityBuckets(
  forecasts: readonly Forecast[],
  bucketCount: number = DEFAULT_BUCKET_COUNT,
): ReliabilityBucket[] {
  const grouped: Forecast[][] = Array.from({ length: bucketCount }, () => []);
  for (const forecast of forecasts) grouped[bucketIndex(forecast.probability, bucketCount)].push(forecast);

  return grouped.map((members, index) => {
    const hits = members.filter((member) => member.happened).length;
    return {
      index,
      from: index / bucketCount,
      to: (index + 1) / bucketCount,
      count: members.length,
      hits,
      meanProbability: members.length > 0 ? mean(members.map((member) => member.probability)) : null,
      observedRate: members.length > 0 ? hits / members.length : null,
    };
  });
}

export function calibrationReport(
  predictions: readonly Pick<Prediction, 'probability' | 'outcome'>[],
  { minClosed = MIN_CLOSED_PREDICTIONS, bucketCount = DEFAULT_BUCKET_COUNT } = {},
): CalibrationReport {
  const forecasts = toForecasts(predictions);
  if (forecasts.length < minClosed || forecasts.length === 0) {
    return { enough: false, closed: forecasts.length, needed: minClosed };
  }
  const meanProbability = mean(forecasts.map((forecast) => forecast.probability));
  const hitRate = forecasts.filter((forecast) => forecast.happened).length / forecasts.length;
  return {
    enough: true,
    closed: forecasts.length,
    brier: mean(forecasts.map(squaredError)),
    meanProbability,
    hitRate,
    bias: meanProbability - hitRate,
    buckets: reliabilityBuckets(forecasts, bucketCount),
  };
}
