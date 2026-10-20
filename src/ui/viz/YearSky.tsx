import { useMemo } from 'react';
import { eachDay } from '../../domain/dates';
import { cx } from '../primitives/cx';
import { MONTHS_NOMINATIVE, MONTHS_SHORT, describeCell, indexCells, relationOf } from './calendar';
import type { DayCell } from './calendar';
import { flowerPath } from './flower';
import { useRoving, useSvgId } from './hooks';
import { MOOD_HEX, moodStep } from './mood';
import { SvgHit } from './SvgHit';
import { YEAR_CELL, YEAR_MONTH_W, YEAR_TITLE_H, YEAR_VIEW_H, YEAR_VIEW_W, monthOrigin, shiftMonthIndex, yearCellCenter } from './yearLayout';
import styles from './YearSky.module.css';
import shared from './viz.module.css';
import { t } from '../../i18n';

export interface YearSkyProps {
  year: number;
  days?: readonly DayCell[];
  today?: string | null;
  selected?: string | null;
  /** Makes every day selectable: one Tab stop, ←/→ a day, ↑/↓ a week, PageUp/PageDown a month. */
  onSelect?: (date: string) => void;
  /** Makes the month titles buttons ("ЯНВ" opens January). */
  onSelectMonth?: (month: string) => void;
  /** dots: a mood-coloured dot per day. garden: a tiny mood flower per day. */
  variant?: 'dots' | 'garden';
  size?: number;
  label?: string;
  className?: string;
}

const MOOD_STEPS_LIST = [-3, -2, -1, 0, 1, 2, 3] as const;

/**
 * "Звёздная карта года" (docs §3.1): twelve mini-months in a 3 × 4 grid. In the garden variant each
 * day with a state is a 12 px mood flower; the flowers are 7 shared `<path>`s used by reference, so
 * 365 of them cost no more than 7.
 */
export function YearSky({ year, days, today = null, selected = null, onSelect, onSelectMonth, variant = 'dots', size = 300, label, className }: YearSkyProps) {
  const id = useSvgId('year');
  const keys = useMemo(() => eachDay(`${year}-01-01`, `${year}-12-31`), [year]);
  const cells = useMemo(() => indexCells(days), [days]);
  const flowers = useMemo(() => MOOD_STEPS_LIST.map((s) => ({ step: s, d: flowerPath(s, { size: YEAR_CELL - 1 }) })), []);
  const stopIndex = Math.max(0, selected ? keys.indexOf(selected) : today ? keys.indexOf(today) : 0);
  const roving = useRoving({
    count: keys.length,
    tabStop: stopIndex,
    wrap: false,
    navigate: (index, key) => {
      if (key === 'ArrowUp') return Math.max(0, index - 7);
      if (key === 'ArrowDown') return Math.min(keys.length - 1, index + 7);
      if (key === 'PageUp') return shiftMonthIndex(keys, index, -1);
      if (key === 'PageDown') return shiftMonthIndex(keys, index, 1);
      if (key === 'ArrowLeft') return Math.max(0, index - 1);
      if (key === 'ArrowRight') return Math.min(keys.length - 1, index + 1);
      return undefined;
    },
  });
  const name = label ?? t('Year {year}', { year });
  const recorded = keys.filter((k) => (cells.get(k)?.count ?? 0) > 0).length;

  return (
    <figure className={cx(shared.figure, styles.root, className)} style={{ width: size }}>
      <svg className={shared.svg} viewBox={`0 0 ${YEAR_VIEW_W} ${YEAR_VIEW_H}`} role={onSelect ? 'group' : 'img'} aria-label={onSelect ? name : t('{name}: days with records {recorded} of {count}', { name, recorded, count: keys.length })}>
        <defs>
          {flowers.map((f) => (
            <path key={f.step} id={`${id}-f${f.step}`} d={f.d} />
          ))}
        </defs>
        {MONTHS_SHORT.map((short, m) => {
          const origin = monthOrigin(m);
          const monthKey = `${year}-${String(m + 1).padStart(2, '0')}`;
          return (
            <g key={short}>
              <SvgHit
                x={origin.x + 18}
                y={origin.y + 7}
                hit={0}
                rect={{ w: 40, h: 18 }}
                label={`${t(MONTHS_NOMINATIVE[m] ?? '')} ${year}`}
                onActivate={onSelectMonth ? () => onSelectMonth(monthKey) : undefined}
              >
                <text x={origin.x} y={origin.y + 11} className={styles.month} aria-hidden="true">
                  {t(short)}
                </text>
              </SvgHit>
              <line x1={origin.x} x2={origin.x + YEAR_MONTH_W} y1={origin.y + YEAR_TITLE_H - 4} y2={origin.y + YEAR_TITLE_H - 4} className={styles.rule} />
            </g>
          );
        })}
        <g role={onSelect ? 'radiogroup' : undefined} aria-label={onSelect ? name : undefined}>
          {keys.map((date, i) => {
            const cell = cells.get(date);
            const relation = relationOf(date, today);
            const { x, y } = yearCellCenter(date);
            const hasMood = cell?.mood !== null && cell?.mood !== undefined;
            const hasData = (cell?.count ?? 0) > 0;
            const step = hasMood ? moodStep(cell!.mood!) : null;
            const future = relation === 'future';
            return (
              <SvgHit
                key={date}
                x={x}
                y={y}
                hit={YEAR_CELL / 2}
                ring={YEAR_CELL / 2 + 1}
                role="radio"
                checked={date === selected}
                label={describeCell(date, cell, relation)}
                onActivate={onSelect ? () => onSelect(date) : undefined}
                {...(onSelect ? roving.itemProps(i) : {})}
              >
                {date === selected ? <circle cx={x} cy={y} r={YEAR_CELL / 2 + 0.5} className={styles.selected} /> : null}
                {relation === 'today' ? <circle cx={x} cy={y} r={YEAR_CELL / 2 + 1} className={styles.todayHalo} /> : null}
                {step !== null && !future ? (
                  variant === 'garden' ? (
                    <use href={`#${id}-f${step}`} x={x - (YEAR_CELL - 1) / 2} y={y - (YEAR_CELL - 1) / 2} style={{ fill: MOOD_HEX[step] }} />
                  ) : (
                    <circle cx={x} cy={y} r={3.6} style={{ fill: MOOD_HEX[step] }} />
                  )
                ) : (
                  <circle
                    cx={x}
                    cy={y}
                    r={hasData && !future ? 2.4 : 1.5}
                    className={hasData && !future ? styles.recorded : styles.empty}
                    style={future ? { opacity: 0.35 } : undefined}
                  />
                )}
              </SvgHit>
            );
          })}
        </g>
      </svg>
    </figure>
  );
}

