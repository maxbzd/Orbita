import { useMemo } from 'react';
import type { Forecast } from '../../domain/calibration';
import { closedPredictionsCount } from '../../domain/counts';
import { cx } from '../primitives/cx';
import { PLOT, PLOT_SIZE, buildCalibrationModel, describeBucket, plotX, plotY } from './calibrationModel';
import styles from './CalibrationChart.module.css';
import shared from './viz.module.css';
import { t } from '../../i18n';

export interface CalibrationChartProps {
  /** Closed predictions: the stated probability (0…1) and whether it came true. */
  forecasts: readonly Forecast[];
  /** Fewer closed predictions than this show "мало данных" instead of a chart. Default 5. */
  minClosed?: number;
  bucketCount?: number;
  size?: number;
  label?: string;
  className?: string;
}

const GRID = [0, 0.25, 0.5, 0.75, 1] as const;

/**
 * Reliability chart ("график надёжности"): x is what you said, y is how often it came true, one
 * dot per probability bucket (bigger = more forecasts). On the dashed diagonal you are calibrated;
 * below it you are too sure. The Brier score is a plain number next to it. Under five closed
 * predictions it says so instead of drawing a curve.
 */
export function CalibrationChart({ forecasts, minClosed = 5, bucketCount = 10, size = 300, label = t('Prediction reliability'), className }: CalibrationChartProps) {
  const model = useMemo(() => buildCalibrationModel(forecasts, { minClosed, bucketCount }), [forecasts, minClosed, bucketCount]);
  const line = model.enough ? model.buckets.map((b, i) => `${i === 0 ? 'M' : 'L'}${b.x.toFixed(1)} ${b.y.toFixed(1)}`).join('') : '';

  return (
    <figure className={cx(shared.figure, styles.root, className)} style={{ width: size }}>
      <svg className={shared.svg} viewBox="0 0 300 300" role="img" aria-label={model.enough ? t('{label}: Brier score {toFixed}', { label, toFixed: model.brier.toFixed(2) }) : t('{label}: not enough data', { label })}>
        {GRID.map((g) => (
          <g key={g} aria-hidden="true">
            <line x1={PLOT.left} x2={PLOT.right} y1={plotY(g)} y2={plotY(g)} className={styles.grid} />
            <line x1={plotX(g)} x2={plotX(g)} y1={PLOT.top} y2={PLOT.bottom} className={styles.grid} />
            <text x={PLOT.left - 8} y={plotY(g)} className={styles.tick} textAnchor="end" dominantBaseline="central">
              {Math.round(g * 100)}
            </text>
            <text x={plotX(g)} y={PLOT.bottom + 16} className={styles.tick} textAnchor="middle">
              {Math.round(g * 100)}
            </text>
          </g>
        ))}
        <text x={PLOT.left + PLOT_SIZE / 2} y={PLOT.bottom + 34} className={styles.axis} textAnchor="middle" aria-hidden="true">
          {t('Said, % →')}
        </text>
        <text x={12} y={PLOT.top + PLOT_SIZE / 2} className={styles.axis} textAnchor="middle" transform={`rotate(-90 12 ${PLOT.top + PLOT_SIZE / 2})`} aria-hidden="true">
          {t('Came true, % →')}
        </text>
        <line x1={plotX(0)} y1={plotY(0)} x2={plotX(1)} y2={plotY(1)} className={styles.ideal} aria-hidden="true" />

        {model.enough ? (
          <g>
            <path d={line} className={styles.curve} />
            {model.buckets.map((b) => (
              <circle key={b.index} cx={b.x} cy={b.y} r={b.r} className={styles.bucket}>
                <title>{describeBucket(b)}</title>
              </circle>
            ))}
          </g>
        ) : (
          <g aria-hidden="true">
            <text x={PLOT.left + PLOT_SIZE / 2} y={PLOT.top + PLOT_SIZE / 2 - 22} className={styles.emptyTitle} textAnchor="middle">
              {t('Not enough data')}
            </text>
            <text x={PLOT.left + PLOT_SIZE / 2} y={PLOT.top + PLOT_SIZE / 2 + 4} className={styles.emptyNote} textAnchor="middle">
              
              {t('Closed {closed} of {needed}', { closed: model.closed, needed: model.needed })}
            </text>
            {Array.from({ length: model.needed }, (_, i) => (
              <circle key={i} cx={PLOT.left + PLOT_SIZE / 2 + (i - (model.needed - 1) / 2) * 18} cy={PLOT.top + PLOT_SIZE / 2 + 28} r={5} className={i < model.closed ? styles.pip : styles.pipEmpty} />
            ))}
          </g>
        )}
      </svg>
      <figcaption className={styles.caption}>
        {model.enough ? (
          <>
            <span className={styles.brier}>
              {t('Brier')}{' '}<b>{model.brier.toFixed(2)}</b>
            </span>
            <span className={styles.note}>
              {t('{closedPredictionsCount}. 0 is perfect, 0.25 is always saying 50 %.', { closedPredictionsCount: closedPredictionsCount(model.closed) })}
            
            </span>
          </>
        ) : (
          <span className={styles.note}>
            
            {t('{closedPredictionsCount} needed, {closed} so far. A reliability estimate appears once there are enough.', { closedPredictionsCount: closedPredictionsCount(model.needed), closed: model.closed })}
          
          </span>
        )}
      </figcaption>
      {model.enough ? (
        <table className={shared.srOnly}>
          <caption>{label}</caption>
          <tbody>
            {model.buckets.map((b) => (
              <tr key={b.index}>
                <td>{describeBucket(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </figure>
  );
}
