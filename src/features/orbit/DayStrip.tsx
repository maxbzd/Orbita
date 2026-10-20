import { useEffect, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { formatDayLong, formatWeekdayShort } from '../../domain/dates';
import type { DayKey } from '../../domain/types';
import { cx, moodHex } from '../../ui';
import type { DayCell } from '../../ui';
import { stripDays } from './model';
import styles from './Orbit.module.css';
import { t } from '../../i18n';

interface DayStripProps {
  /** The selected day: the global time cursor. */
  day: DayKey;
  today: DayKey;
  cells: readonly DayCell[];
  onSelect(day: DayKey): void;
}

/** A scrollable strip of days (the week before, this one, the next): the cursor all views share. */
export function DayStrip({ day, today, cells, onSelect }: DayStripProps) {
  const days = useMemo(() => stripDays(day), [day]);
  const byDay = useMemo(() => new Map(cells.map((cell) => [cell.date, cell])), [cells]);
  const box = useRef<HTMLDivElement>(null);

  // Keep the selected day in the middle of the strip (no scrollIntoView: it would move the page too).
  useEffect(() => {
    const el = box.current;
    const selected = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (el && selected) el.scrollLeft = selected.offsetLeft - (el.clientWidth - selected.offsetWidth) / 2;
  }, [day]);

  return (
    <div ref={box} className={styles.strip} role="group" aria-label={t('Day strip')}>
      {days.map((date) => {
        const cell = byDay.get(date);
        const selected = date === day;
        const style = { '--dot': cell?.mood !== undefined && cell.mood !== null ? moodHex(cell.mood) : 'transparent' } as CSSProperties;
        return (
          <button
            key={date}
            type="button"
            className={cx(styles.stripDay, selected && styles.stripSelected, date === today && styles.stripToday, date > today && styles.stripFuture)}
            aria-pressed={selected}
            aria-current={date === today ? 'date' : undefined}
            aria-label={formatDayLong(date)}
            onClick={() => onSelect(date)}
          >
            <span className={styles.stripWeekday}>{formatWeekdayShort(date)}</span>
            <span className={styles.stripNumber}>{Number(date.slice(8, 10))}</span>
            <span className={styles.stripDot} style={style} aria-hidden="true" />
            <span className={cx(styles.stripCount, !cell?.count && styles.stripCountEmpty)} aria-hidden="true">
              {cell?.count ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}
