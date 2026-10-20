import { t, tn } from '../../i18n';
import { Body, Caption, Chip, Label } from '../../ui';
import type { TagCount, TrendResult } from './model';
import styles from './Orbit.module.css';

interface TrendBlockProps {
  trend: TrendResult;
  tags: readonly TagCount[];
}

/** «Тренд замечен» under the figure: two plain sentences by rules, then the tags with counters. */
export function TrendBlock({ trend, tags }: TrendBlockProps) {
  const title = trend.kind === 'trend' ? t('Trend noticed') : trend.kind === 'steady' ? t('Steady') : t('No trend visible yet');
  return (
    <section className={styles.trend} aria-labelledby="trend-title">
      <Label as="h2" tone="strong" id="trend-title">
        {title}
      </Label>
      {trend.kind === 'few' ? (
        <Body tone="muted">
          {tn(trend.needDays, 'Need {n} day with a mood check-in, so far {have}. Check in on the “Today” screen.', 'Need {n} days with a mood check-in, so far {have}. Check in on the “Today” screen.', { have: trend.haveDays })}
        </Body>
      ) : (
        <div className={styles.trendText}>
          {trend.sentences.map((sentence) => (
            <Body key={sentence}>{sentence}</Body>
          ))}
        </div>
      )}
      {tags.length > 0 ? (
        <ul className={styles.tags} aria-label={t('Themes of the period')}>
          {tags.map((entry) => (
            <li key={entry.tag}>
              <Chip count={entry.count}>{entry.tag}</Chip>
            </li>
          ))}
        </ul>
      ) : null}
      <Caption tone="faint">{t('Calculated by rules, without AI: the first and second halves of the period are compared.')}</Caption>
    </section>
  );
}
