import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { recordsCount } from '../../domain/counts';
import { formatDayLong } from '../../domain/dates';
import { cx } from '../primitives/cx';
import { MONTHS_SHORT, relationOf } from './calendar';
import { useRoving } from './hooks';
import { heatGrid, heatLevel, monthLabels } from './heatGrid';
import styles from './Heat.module.css';
import { t, msg } from '../../i18n';

export interface HeatProps {
  /** First and last day, `YYYY-MM-DD`. The grid is Monday-first, one column per week. */
  from: string;
  to: string;
  /** Value per day (records, minutes …). Missing days count as 0. */
  values: Readonly<Record<string, number>>;
  /** What 100 % is. Default: the largest value. */
  max?: number;
  today?: string | null;
  selected?: string | null;
  onSelect?: (date: string) => void;
  /** Cell size in px. Default 14; the grid scrolls sideways if it is wider than its box. */
  cell?: number;
  /** Colour of a full cell. Default ink. */
  color?: string;
  /** Noun for the spoken value: ['запись','записи','записей']. */
  unit?: (count: number) => string;
  label?: string;
  className?: string;
}

const WEEKDAY_LABELS: ReadonlyArray<[number, string]> = [
  [0, msg('Mon')],
  [2, msg('Wed')],
  [4, msg('Fri')],
];

/**
 * A grid of days (weeks as columns), each cell as strong as its value. Real HTML, not a picture,
 * so labels keep their size and the grid scrolls sideways when the range is long.
 */
export function Heat({ from, to, values, max, today = null, selected = null, onSelect, cell = 14, color = 'var(--ink)', unit = recordsCount, label = t('Days'), className }: HeatProps) {
  const cells = useMemo(() => heatGrid(from, to), [from, to]);
  const top = max ?? Math.max(0, ...cells.map((c) => values[c.date] ?? 0));
  const months = useMemo(() => monthLabels(cells), [cells]);
  const weeks = (cells[cells.length - 1]?.col ?? 0) + 1;
  const selectedIndex = Math.max(0, cells.findIndex((c) => c.date === (selected ?? today)));
  const roving = useRoving<HTMLButtonElement>({
    count: cells.length,
    tabStop: selectedIndex,
    wrap: false,
    navigate: (index, key) => {
      if (key === 'ArrowDown') return Math.min(cells.length - 1, index + 1);
      if (key === 'ArrowUp') return Math.max(0, index - 1);
      if (key === 'ArrowRight') return Math.min(cells.length - 1, index + 7);
      if (key === 'ArrowLeft') return Math.max(0, index - 7);
      return undefined;
    },
  });

  return (
    <div className={cx(styles.scroll, className)}>
      <div
        className={styles.grid}
        role={onSelect ? 'radiogroup' : 'img'}
        aria-label={onSelect ? label : t('{label}: {count} of {count2}', { label, count: cells.filter((c) => (values[c.date] ?? 0) > 0).length, count2: cells.length })}
        style={{ '--cell': `${cell}px`, '--heat': color, gridTemplateColumns: `auto repeat(${weeks}, var(--cell))` } as CSSProperties}
      >
        {months.map((m) => (
          <span key={`${m.col}-${m.month}`} className={styles.month} style={{ gridRow: 1, gridColumn: `${m.col + 2} / span 3` }} aria-hidden="true">
            {t(MONTHS_SHORT[m.month] ?? '')}
          </span>
        ))}
        {WEEKDAY_LABELS.map(([row, text]) => (
          <span key={text} className={styles.weekday} style={{ gridRow: row + 2, gridColumn: 1 }} aria-hidden="true">
            {t(text)}
          </span>
        ))}
        {cells.map((c, i) => {
          const value = values[c.date] ?? 0;
          const level = heatLevel(value, top);
          const relation = relationOf(c.date, today);
          const text = `${formatDayLong(c.date)}: ${value > 0 ? unit(value) : t('empty')}`;
          const style = { gridRow: c.row + 2, gridColumn: c.col + 2 } as CSSProperties;
          const className = cx(styles.cell, styles[`l${level}`], relation === 'future' && styles.future, relation === 'today' && styles.today, c.date === selected && styles.selected);
          return onSelect ? (
            <button key={c.date} type="button" role="radio" aria-checked={c.date === selected} aria-label={text} title={text} className={className} style={style} onClick={() => onSelect(c.date)} {...roving.itemProps(i)} />
          ) : (
            <span key={c.date} title={text} className={className} style={style} />
          );
        })}
      </div>
    </div>
  );
}
