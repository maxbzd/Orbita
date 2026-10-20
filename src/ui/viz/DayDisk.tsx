import { useMemo } from 'react';
import { formatDayLong, formatWeekdayShort } from '../../domain/dates';
import { IconButton } from '../primitives/IconButton';
import { cx } from '../primitives/cx';
import { TYPE_LABELS, typeColor } from '../primitives/kinds';
import type { TypeKind } from '../primitives/kinds';
import { minutesToAngle, minutesToClock } from './dayGeometry';
import { useRoving } from './hooks';
import { moodHex, moodWord } from './mood';
import { polar, sectorPath } from './polar';
import { SvgHit, focusRingClass, hitAreaClass } from './SvgHit';
import styles from './DayDisk.module.css';
import shared from './viz.module.css';
import { t } from '../../i18n';

export interface DiskSegment {
  id: string;
  startMinutes: number;
  endMinutes: number;
  kind: TypeKind;
  label: string;
}

export interface DiskMood {
  startMinutes: number;
  endMinutes: number;
  /** −3…+3 */
  mood: number;
}

export interface DayDiskProps {
  /** The day shown, `YYYY-MM-DD`. */
  date: string;
  /** Activities on the outer ring, coloured by record type. */
  segments?: readonly DiskSegment[];
  /** Moods on the inner ring. */
  moods?: readonly DiskMood[];
  /** Minutes since midnight of "now" (omit for a day that is not today). */
  nowMinutes?: number | null;
  selectedId?: string | null;
  /** Makes the segments selectable (tap again to clear). */
  onSelect?: (id: string | null) => void;
  /** Shows ‹ › buttons round the date and switches the selected day. */
  onStepDay?: (delta: -1 | 1) => void;
  size?: number;
  className?: string;
}

const VIEW = 300;
const C = VIEW / 2;
const OUTER_IN = 108;
const OUTER_OUT = 126;
const MOOD_IN = 86;
const MOOD_OUT = 100;
/** A segment shorter than 2.5° would vanish, so it is drawn at least this wide. */
const MIN_SWEEP = 0.044;

/** Start and end angles of a span, widened to the minimum and kept inside the day. */
export function spanAngles(startMinutes: number, endMinutes: number): [number, number] {
  const a0 = minutesToAngle(Math.min(startMinutes, endMinutes));
  const a1 = minutesToAngle(Math.max(startMinutes, endMinutes));
  if (a1 - a0 >= MIN_SWEEP) return [a0, a1];
  const mid = (a0 + a1) / 2;
  return [mid - MIN_SWEEP / 2, mid + MIN_SWEEP / 2];
}

const LABEL_HOURS = [
  { minutes: 720, text: '12' },
  { minutes: 1080, text: '18' },
  { minutes: 0, text: '0' },
  { minutes: 360, text: '6' },
] as const;

/**
 * "Диск суток" (after Lumy): the day as a disc, noon on top. The outer ring shows what happened
 * (one arc per activity, in the colour of its type), the inner ring how it felt (one arc per
 * mood span). Select an arc to read it in the middle; step the day with the arrows.
 */
export function DayDisk({ date, segments = [], moods = [], nowMinutes = null, selectedId = null, onSelect, onStepDay, size = 300, className }: DayDiskProps) {
  const roving = useRoving({ count: segments.length });
  const selected = segments.find((s) => s.id === selectedId) ?? null;
  const dayLong = useMemo(() => formatDayLong(date), [date]);
  const weekday = useMemo(() => formatWeekdayShort(date), [date]);
  const dayNumber = Number(date.slice(8, 10));
  const now = nowMinutes !== null && nowMinutes >= 0 && nowMinutes < 1440 ? polar(C, C, (OUTER_IN + OUTER_OUT) / 2, minutesToAngle(nowMinutes)) : null;
  const dim = selected !== null;

  return (
    <figure className={cx(shared.figure, styles.root, className)} style={{ width: size }}>
      {onStepDay ? (
        <div className={styles.stepper}>
          <IconButton icon="chevron-left" label={t('Previous day')} onClick={() => onStepDay(-1)} />
          <span className={styles.date} aria-live="polite">
            {dayLong}
          </span>
          <IconButton icon="chevron-right" label={t('Next day')} onClick={() => onStepDay(1)} />
        </div>
      ) : null}
      <svg className={shared.svg} viewBox={`0 0 ${VIEW} ${VIEW}`} role="group" aria-label={t('Day disk, {dayLong}', { dayLong })}>
        <circle cx={C} cy={C} r={(OUTER_IN + OUTER_OUT) / 2} className={styles.track} style={{ strokeWidth: OUTER_OUT - OUTER_IN }} />
        <circle cx={C} cy={C} r={(MOOD_IN + MOOD_OUT) / 2} className={styles.track} style={{ strokeWidth: MOOD_OUT - MOOD_IN }} />
        {LABEL_HOURS.map((h) => {
          const a = minutesToAngle(h.minutes);
          const p = polar(C, C, OUTER_OUT + 14, a);
          return (
            <text key={h.minutes} x={p.x} y={p.y} className={styles.hour} textAnchor="middle" dominantBaseline="central" aria-hidden="true">
              {h.text}
            </text>
          );
        })}

        <g role="img" aria-label={moods.length === 0 ? t('State for the day not logged') : t('State: {v}', { v: moods.map((m) => `${minutesToClock(m.startMinutes)}–${minutesToClock(m.endMinutes)} ${moodWord(m.mood)}`).join('; ') })}>
          {moods.map((m) => {
            const [a0, a1] = spanAngles(m.startMinutes, m.endMinutes);
            return <path key={`${m.startMinutes}-${m.endMinutes}`} d={sectorPath(C, C, MOOD_IN, MOOD_OUT, a0, a1)} style={{ fill: moodHex(m.mood) }} className={styles.moodArc} />;
          })}
        </g>

        {segments.map((s, i) => {
          const [a0, a1] = spanAngles(s.startMinutes, s.endMinutes);
          const isSelected = s.id === selectedId;
          const rOut = isSelected ? OUTER_OUT + 4 : OUTER_OUT;
          const d = sectorPath(C, C, OUTER_IN, rOut, a0, a1);
          const mid = polar(C, C, (OUTER_IN + OUTER_OUT) / 2, (a0 + a1) / 2);
          return (
            <SvgHit
              key={s.id}
              x={mid.x}
              y={mid.y}
              hit={0}
              label={`${minutesToClock(s.startMinutes)}–${minutesToClock(s.endMinutes)}, ${TYPE_LABELS[s.kind]}: ${s.label}`}
              pressed={isSelected}
              onActivate={onSelect ? () => onSelect(isSelected ? null : s.id) : undefined}
              shapes={{
                hit: <path d={sectorPath(C, C, OUTER_IN - 6, OUTER_OUT + 8, a0, a1)} className={hitAreaClass} />,
                ring: <path d={sectorPath(C, C, OUTER_IN - 3, OUTER_OUT + 6, a0 - 0.02, a1 + 0.02)} className={focusRingClass} />,
              }}
              {...(onSelect ? roving.itemProps(i) : {})}
            >
              <title>{`${minutesToClock(s.startMinutes)}–${minutesToClock(s.endMinutes)} · ${s.label}`}</title>
              <path d={d} className={cx(styles.segment, isSelected && styles.segmentSelected)} style={{ fill: typeColor(s.kind), opacity: dim && !isSelected ? 0.5 : 1 }} />
            </SvgHit>
          );
        })}

        {now ? (
          <g aria-hidden="true">
            <circle cx={now.x} cy={now.y} r={11} className={styles.nowHalo} />
            <circle cx={now.x} cy={now.y} r={5.5} className={styles.nowDot} />
          </g>
        ) : null}

        <g aria-hidden="true">
          {selected ? (
            <>
              <text x={C} y={C - 12} textAnchor="middle" dominantBaseline="central" className={styles.centerTime}>
                {minutesToClock(selected.startMinutes)}–{minutesToClock(selected.endMinutes)}
              </text>
              <text x={C} y={C + 12} textAnchor="middle" dominantBaseline="central" className={styles.centerLabel}>
                {TYPE_LABELS[selected.kind]}
              </text>
            </>
          ) : (
            <>
              <text x={C} y={C - 6} textAnchor="middle" dominantBaseline="central" className={styles.centerNumber}>
                {dayNumber}
              </text>
              <text x={C} y={C + 24} textAnchor="middle" dominantBaseline="central" className={styles.centerLabel}>
                {weekday}
              </text>
            </>
          )}
        </g>
      </svg>
    </figure>
  );
}
