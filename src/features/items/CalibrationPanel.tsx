import { useMemo } from 'react';
import { toForecasts } from '../../domain/calibration';
import type { Item } from '../../domain/types';
import { CalibrationChart, Caption, Heading } from '../../ui';
import { predictionReport, summarizeCalibration } from './model';
import styles from './CalibrationPanel.module.css';
import { t } from '../../i18n';

/**
 * «Сказал 70 % → сбылось 55 %»: the reliability chart and the Brier score.
 * Under five closed forecasts it says «Мало данных» and how many are missing, instead of drawing a curve.
 */
export function CalibrationPanel({ predictions }: { predictions: readonly Item[] }) {
  const report = useMemo(() => predictionReport(predictions), [predictions]);
  const forecasts = useMemo(() => toForecasts(predictions.flatMap((item) => (item.kind === 'prediction' ? [item] : []))), [predictions]);
  const summary = summarizeCalibration(report);
  return (
    <section className={styles.panel} aria-label={t('Calibration')} data-testid="calibration">
      <div className={styles.chart}>
        <CalibrationChart forecasts={forecasts} size={240} />
      </div>
      <div className={styles.text}>
        <Heading as="h2" variant="headline">
          {summary.headline}
        </Heading>
        {summary.lines.map((line) => (
          <Caption key={line}>{line}</Caption>
        ))}
      </div>
    </section>
  );
}
