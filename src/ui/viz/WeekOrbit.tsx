import { useMemo, useRef } from 'react';
import type { PointerEvent } from 'react';
import { cx } from '../primitives/cx';
import { WEEKDAYS_SHORT, describeCell, indexCells, relationOf, weekDayKeys } from './calendar';
import type { DayCell } from './calendar';
import { useRoving } from './hooks';
import { moodHex } from './mood';
import { angleOf, arcPath, polar, slotAt, TAU } from './polar';
import { SvgHit } from './SvgHit';
import styles from './Rings.module.css';
import shared from './viz.module.css';
import { t } from '../../i18n';

export interface WeekOrbitProps {
  /** Any day of the week to show (the week starts on Monday). */
  week: string;
  days?: readonly DayCell[];
  today?: string | null;
  selected?: string | null;
  /** Makes the days selectable by tap, by dragging round the orbit (the scrubber) and by arrow keys. */
  onSelect?: (date: string) => void;
  /**
   * The time cursor: where "now" is inside the week (a cream needle on the orbit). Omit for a
   * week that is not the current one.
   */
  cursor?: { date: string; minutes: number } | null;
  value?: number | string;
  valueLabel?: string;
  size?: number;
  label?: string;
  className?: string;
}

const VIEW = 300;
const C = VIEW / 2;
const R = 96;
const LABEL_R = 132;

/** Dot radius for a count of records: 8 px empty, growing to 17 px. */
export function weekDotRadius(count: number | undefined): number {
  return 8 + Math.min(6, Math.max(0, count ?? 0)) * 1.5;
}

/** Angle of the time cursor on the orbit: day slot i is centred on i·2π/7, a day spans one step. */
export function cursorAngle(dayIndex: number, minutes: number): number {
  return ((dayIndex + Math.min(1440, Math.max(0, minutes)) / 1440 - 0.5) / 7) * TAU;
}

/**
 * "Орбита недели" (docs §3.1): seven dots on one orbit, Monday on top, clockwise, labelled
 * Пн–Вс. The colour of a dot is that day's mood, its size is the number of records. A cream
 * needle shows the time cursor; the whole orbit is a scrubber.
 */
export function WeekOrbit({ week, days, today = null, selected = null, onSelect, cursor = null, value, valueLabel, size = 300, label = t('Week'), className }: WeekOrbitProps) {
  const keys = useMemo(() => weekDayKeys(week), [week]);
  const cells = useMemo(() => indexCells(days), [days]);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const selectedIndex = Math.max(0, selected ? keys.indexOf(selected) : today ? keys.indexOf(today) : 0);
  const roving = useRoving({ count: keys.length, tabStop: selectedIndex });
  const cursorIndex = cursor ? keys.indexOf(cursor.date) : -1;
  const needle = cursor && cursorIndex >= 0 ? cursorAngle(cursorIndex, cursor.minutes) : null;

  const selectAt = (event: PointerEvent<SVGSVGElement>): void => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !onSelect || rect.width === 0) return;
    const scale = VIEW / rect.width;
    const x = (event.clientX - rect.left) * scale;
    const y = (event.clientY - rect.top) * scale;
    // Only the band round the orbit scrubs; the middle and the far corners are left alone.
    const distance = Math.hypot(x - C, y - C);
    if (distance < 40 || distance > 150) return;
    const date = keys[slotAt(angleOf(C, C, x, y), 7)];
    if (date) onSelect(date);
  };

  return (
    <figure className={cx(shared.figure, styles.root, className)} style={{ width: size }}>
      <svg
        ref={svgRef}
        className={cx(shared.svg, onSelect && styles.scrub)}
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        role={onSelect ? 'group' : 'img'}
        aria-label={onSelect ? undefined : label}
        onPointerDown={(event) => {
          if (!onSelect) return;
          dragging.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          selectAt(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) selectAt(event);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <circle cx={C} cy={C} r={R} className={styles.track} />
        {needle !== null ? (
          <path d={arcPath(C, C, R, -TAU / 14, needle)} className={styles.arc} opacity={0.35} />
        ) : null}
        <g role={onSelect ? 'radiogroup' : undefined} aria-label={onSelect ? label : undefined}>
          {keys.map((date, i) => {
            const cell = cells.get(date);
            const relation = relationOf(date, today);
            const angle = (i / 7) * TAU;
            const p = polar(C, C, R, angle);
            const text = polar(C, C, LABEL_R, angle);
            const radius = weekDotRadius(cell?.count);
            const hasMood = cell?.mood !== null && cell?.mood !== undefined;
            const hasData = (cell?.count ?? 0) > 0;
            const filled = relation !== 'future' && (hasMood || hasData);
            return (
              <g key={date}>
                <text x={text.x} y={text.y} textAnchor="middle" dominantBaseline="central" aria-hidden="true" className={cx(styles.weekday, date === selected && styles.weekdayActive)}>
                  {t(WEEKDAYS_SHORT[i] ?? '')}
                </text>
                <SvgHit
                  x={p.x}
                  y={p.y}
                  hit={Math.max(22, radius + 4)}
                  ring={radius + 5}
                  role="radio"
                  checked={date === selected}
                  label={describeCell(date, cell, relation)}
                  onActivate={onSelect ? () => onSelect(date) : undefined}
                  {...(onSelect ? roving.itemProps(i) : {})}
                >
                  {date === selected ? <circle cx={p.x} cy={p.y} r={radius + 5} className={styles.selected} /> : null}
                  {relation === 'today' ? <circle cx={p.x} cy={p.y} r={radius + 8} className={styles.todayHalo} /> : null}
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={radius}
                    className={cx(styles.dot, !filled && styles.hollow)}
                    style={{ fill: filled ? (hasMood ? moodHex(cell!.mood!) : 'var(--ink-3)') : undefined, opacity: relation === 'future' ? 0.35 : 1 }}
                  />
                </SvgHit>
              </g>
            );
          })}
        </g>
        {needle !== null ? (
          <g aria-hidden="true">
            <circle cx={polar(C, C, R, needle).x} cy={polar(C, C, R, needle).y} r={10} className={styles.cursorHalo} />
            <circle cx={polar(C, C, R, needle).x} cy={polar(C, C, R, needle).y} r={5} className={styles.cursor} />
          </g>
        ) : null}
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
