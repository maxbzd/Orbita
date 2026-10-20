import { useMemo } from 'react';
import { cx } from '../primitives/cx';
import { MONTHS_NOMINATIVE, describeCell, indexCells, monthDayKeys, relationOf } from './calendar';
import type { DayCell } from './calendar';
import { useRoving } from './hooks';
import { moodHex } from './mood';
import { polar, TAU } from './polar';
import { SvgHit } from './SvgHit';
import styles from './Rings.module.css';
import shared from './viz.module.css';
import { t } from '../../i18n';

export interface MonthRingProps {
  /** The month as `YYYY-MM`. */
  month: string;
  /** Data for the days that have any; the others are drawn as empty rings. */
  days?: readonly DayCell[];
  /** Today as `YYYY-MM-DD`: later days are faded to 35 %, today is bigger. Omit for a finished month. */
  today?: string | null;
  selected?: string | null;
  /** Makes the days selectable (radio group, one Tab stop, arrow keys). */
  onSelect?: (date: string) => void;
  /** The number in the middle (records in the month, for example) and what it counts. */
  value?: number | string;
  valueLabel?: string;
  /** Rendered width in CSS px. Default 300. */
  size?: number;
  label?: string;
  className?: string;
}

const VIEW = 300;
const C = VIEW / 2;
const R = 112;

/**
 * "Кольцо месяца" (docs §3.1): 28–31 dots round a circle, day 1 at the top, running clockwise.
 * The colour of a dot is the mood of that day; today is bigger, the future is faded to 35 %.
 */
export function MonthRing({ month, days, today = null, selected = null, onSelect, value, valueLabel, size = 300, label, className }: MonthRingProps) {
  const keys = useMemo(() => monthDayKeys(month), [month]);
  const cells = useMemo(() => indexCells(days), [days]);
  const selectedIndex = Math.max(0, selected ? keys.indexOf(selected) : today ? keys.indexOf(today) : 0);
  const roving = useRoving({ count: keys.length, tabStop: selectedIndex, wrap: true });
  const monthName = t(MONTHS_NOMINATIVE[Number(month.slice(5, 7)) - 1] ?? month);
  const name = label ?? `${monthName} ${month.slice(0, 4)}`;
  const recorded = keys.filter((k) => (cells.get(k)?.count ?? 0) > 0).length;
  // Dots are 7 px, 9.5 px for today. Neighbours on a 31-dot ring sit ≈ 22 px apart, so they never touch.
  return (
    <figure className={cx(shared.figure, styles.root, className)} style={{ width: size }}>
      <svg className={shared.svg} viewBox={`0 0 ${VIEW} ${VIEW}`} role={onSelect ? 'group' : 'img'} aria-label={onSelect ? undefined : t('{name}: days with records {recorded} of {count}', { name, recorded, count: keys.length })}>
        <circle cx={C} cy={C} r={R} className={styles.track} />
        <g role={onSelect ? 'radiogroup' : undefined} aria-label={onSelect ? name : undefined}>
          {keys.map((date, i) => {
            const cell = cells.get(date);
            const relation = relationOf(date, today);
            const p = polar(C, C, R, (i / keys.length) * TAU);
            const isToday = relation === 'today';
            const radius = isToday ? 9.5 : 6.5;
            const hasMood = cell?.mood !== null && cell?.mood !== undefined;
            const hasData = (cell?.count ?? 0) > 0;
            const filled = relation !== 'future' && (hasMood || hasData);
            return (
              <SvgHit
                key={date}
                x={p.x}
                y={p.y}
                hit={11}
                ring={radius + 4}
                role="radio"
                checked={date === selected}
                label={describeCell(date, cell, relation)}
                onActivate={onSelect ? () => onSelect(date) : undefined}
                {...(onSelect ? roving.itemProps(i) : {})}
              >
                {date === selected ? <circle cx={p.x} cy={p.y} r={radius + 5} className={styles.selected} /> : null}
                {isToday ? <circle cx={p.x} cy={p.y} r={radius + 4} className={styles.todayHalo} /> : null}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={radius}
                  className={cx(styles.dot, !filled && styles.hollow)}
                  style={{ fill: filled ? (hasMood ? moodHex(cell!.mood!) : 'var(--ink-3)') : undefined, opacity: relation === 'future' ? 0.35 : 1 }}
                />
              </SvgHit>
            );
          })}
        </g>
        {value !== undefined ? (
          <g aria-hidden="true">
            <text x={C} y={valueLabel ? C - 4 : C} className={styles.center} textAnchor="middle" dominantBaseline="central">
              {value}
            </text>
            {valueLabel ? (
              <text x={C} y={C + 26} className={styles.centerLabel} textAnchor="middle" dominantBaseline="central">
                {valueLabel}
              </text>
            ) : null}
          </g>
        ) : null}
      </svg>
    </figure>
  );
}
