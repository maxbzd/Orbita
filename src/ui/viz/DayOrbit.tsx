import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { itemKindCount, recordsCount } from '../../domain/counts';
import { cx } from '../primitives/cx';
import { TYPE_LABELS, typeColor } from '../primitives/kinds';
import type { TypeKind } from '../primitives/kinds';
import {
  DAY_RING_RADIUS,
  MAX_SATELLITES,
  ORBIT_CENTER,
  ORBIT_VIEW,
  PLANET_RADIUS,
  SATELLITE_ORBIT_RADIUS,
  layoutRingDots,
  layoutSatellites,
  minutesToAngle,
  minutesToClock,
} from './dayGeometry';
import type { RingEntryInput, SatelliteInput } from './dayGeometry';
import { useRoving, useSvgId } from './hooks';
import { moodHex, moodInk, moodWord } from './mood';
import { arcPath, polar } from './polar';
import { SvgHit } from './SvgHit';
import styles from './DayOrbit.module.css';
import shared from './viz.module.css';
import { t } from '../../i18n';

export interface DayOrbitEntry extends RingEntryInput {
  kind: TypeKind;
  /** Short title: tooltip and screen-reader list. */
  label: string;
}

export interface DayOrbitSatellite extends SatelliteInput {
  /** The commitment's title. */
  title: string;
  /** "через 4 дня", "просрочено на 2 дня": read aloud, so lateness is not only red. */
  dueLabel?: string;
}

export interface DayOrbitProps {
  /** Mood of the day, −3…+3. Null/undefined: a quiet, unlit planet. */
  mood?: number | null;
  /** The number on the planet (what is burning). Default: the count of overdue + open satellites. */
  value?: number | string;
  /** What the number means, for screen readers ("горит"). */
  valueLabel?: string;
  entries?: readonly DayOrbitEntry[];
  /** Commitments, most urgent first. Up to 7 are drawn, the rest become one "+N" bubble. */
  satellites?: readonly DayOrbitSatellite[];
  /**
   * Minutes since midnight of "now" on the ring. Omit/null: there is no now (every dot is full).
   * For a past day pass 1440, for a future day pass −1: the marker is then hidden and the dots
   * are all full or all faded.
   */
  nowMinutes?: number | null;
  /** full: the hero (300 px, touch targets for every dot). compact: a preview, only the planet is a target. */
  mode?: 'compact' | 'full';
  /** Rendered width in CSS px. Default 300 (full) / 168 (compact). */
  size?: number;
  /** Accessible name of the figure. */
  label?: string;
  /** Name of the planet button ("Открыть день"). */
  planetLabel?: string;
  onPlanetClick?: () => void;
  onEntryClick?: (id: string) => void;
  onSatelliteClick?: (id: string) => void;
  onOverflowClick?: () => void;
  className?: string;
}

/** The sentence a screen reader gets in place of the picture. Pure, so it is easy to test. */
export function describeDayOrbit({
  mood,
  entries = [],
  satellites = [],
  value,
  valueLabel,
}: Pick<DayOrbitProps, 'mood' | 'entries' | 'satellites' | 'value' | 'valueLabel'>): string[] {
  const lines: string[] = [];
  lines.push(mood === null || mood === undefined ? t('State of the day not logged.') : t('State of the day: {moodWord}.', { moodWord: moodWord(mood) }));
  if (value !== undefined && valueLabel) lines.push(`${valueLabel}: ${value}.`);
  const sorted = [...entries].sort((a, b) => a.minutes - b.minutes);
  lines.push(
    sorted.length === 0
      ? t('No records today.')
      : `${recordsCount(sorted.length)}: ${sorted
          .map((e) => `${minutesToClock(e.minutes)} ${TYPE_LABELS[e.kind].toLowerCase()}, ${e.label}`)
          .join('; ')}.`,
  );
  if (satellites.length === 0) lines.push(t('No open commitments.'));
  else {
    const late = satellites.filter((s) => s.overdue).length;
    const head = `${itemKindCount('commitment', satellites.length)}${late > 0 ? t(', overdue {late}', { late }) : ''}`;
    lines.push(`${head}: ${satellites.map((s) => `${s.title}${s.overdue ? t(' (overdue)') : ''}${s.dueLabel ? `, ${s.dueLabel}` : ''}`).join('; ')}.`);
  }
  return lines;
}

const HOURS: ReadonlyArray<{ minutes: number; text: string }> = [
  { minutes: 720, text: '12' },
  { minutes: 1080, text: '18' },
  { minutes: 0, text: '0' },
  { minutes: 360, text: '6' },
];

/**
 * "Орбита дня" (docs §3.1): the planet (colour and gloss by mood, a number in the middle), the day
 * ring (noon on top; records as dots in their type colour, the past at full strength, the future
 * at 35 %, "now" as a cream dot with a halo) and the orbit of commitment satellites (up to 7 and
 * "+N"; overdue ones are red diamonds, never just red).
 */
export function DayOrbit({
  mood = null,
  value,
  valueLabel = t('Burning'),
  entries = [],
  satellites = [],
  nowMinutes = null,
  mode = 'full',
  size,
  label = t('Orbit of the day'),
  planetLabel = t('Open the day'),
  onPlanetClick,
  onEntryClick,
  onSatelliteClick,
  onOverflowClick,
  className,
}: DayOrbitProps) {
  const full = mode === 'full';
  const width = size ?? (full ? 300 : 168);
  const id = useSvgId('day');
  const lit = mood !== null && mood !== undefined;
  const planetFill = lit ? moodHex(mood) : null;
  const burning = satellites.filter((s) => s.overdue).length || satellites.length;
  const shownValue = value ?? burning;
  const showNow = nowMinutes !== null && nowMinutes >= 0 && nowMinutes < 1440;
  const nowAngle = showNow ? minutesToAngle(nowMinutes) : null;

  const dots = useMemo(() => layoutRingDots(entries, nowMinutes), [entries, nowMinutes]);
  const slots = useMemo(() => layoutSatellites(satellites), [satellites]);
  const entryRoving = useRoving({ count: dots.length });
  const satelliteRoving = useRoving({ count: slots.length });
  const description = useMemo(() => describeDayOrbit({ mood, entries, satellites, value: shownValue, valueLabel }), [mood, entries, satellites, shownValue, valueLabel]);

  const interactiveDots = full && onEntryClick !== undefined;
  const interactiveSatellites = full;
  const now = nowAngle === null ? null : polar(ORBIT_CENTER, ORBIT_CENTER, DAY_RING_RADIUS, nowAngle);
  const gloss = polar(ORBIT_CENTER, ORBIT_CENTER, 28, -0.75);
  const dotRadius = full ? 5 : 4.5;

  return (
    <figure className={cx(shared.figure, styles.root, className)} style={{ width }} data-mode={mode}>
      <svg
        className={shared.svg}
        viewBox={`0 0 ${ORBIT_VIEW} ${ORBIT_VIEW}`}
        role="group"
        aria-label={label}
        aria-describedby={`${id}-desc`}
      >
        <defs>
          <radialGradient id={`${id}-planet`} cx={gloss.x} cy={gloss.y} r="78" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0.08" />
            <stop offset="1" stopColor="#000" stopOpacity="0.32" />
          </radialGradient>
          <radialGradient id={`${id}-halo`} cx="50%" cy="50%" r="50%">
            <stop offset="0" stopColor={planetFill ?? '#8d93b0'} stopOpacity="0.38" />
            <stop offset="1" stopColor={planetFill ?? '#8d93b0'} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* The glow of the planet: static, so it costs nothing. */}
        <circle cx={ORBIT_CENTER} cy={ORBIT_CENTER} r={SATELLITE_ORBIT_RADIUS - 8} fill={`url(#${id}-halo)`} />

        {/* Day ring: the future is a faint track, the past (midnight → now) is drawn over it. */}
        <circle cx={ORBIT_CENTER} cy={ORBIT_CENTER} r={DAY_RING_RADIUS} className={styles.track} />
        {nowAngle !== null ? <path d={arcPath(ORBIT_CENTER, ORBIT_CENTER, DAY_RING_RADIUS, -Math.PI, nowAngle)} className={styles.past} /> : null}
        {nowMinutes !== null && nowMinutes >= 1440 ? <circle cx={ORBIT_CENTER} cy={ORBIT_CENTER} r={DAY_RING_RADIUS} className={styles.past} /> : null}
        {HOURS.map((h) => {
          const a = minutesToAngle(h.minutes);
          const inner = polar(ORBIT_CENTER, ORBIT_CENTER, DAY_RING_RADIUS - 5, a);
          const outer = polar(ORBIT_CENTER, ORBIT_CENTER, DAY_RING_RADIUS + 5, a);
          const text = polar(ORBIT_CENTER, ORBIT_CENTER, DAY_RING_RADIUS + 20, a);
          return (
            <g key={h.minutes} aria-hidden="true">
              <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} className={styles.tick} />
              {full ? (
                <text x={text.x} y={text.y} className={styles.hour} textAnchor="middle" dominantBaseline="central">
                  {h.text}
                </text>
              ) : null}
            </g>
          );
        })}

        {/* Satellite orbit: a dashed line that turns slowly (96 s); the satellites themselves stand still, so they are easy to hit. */}
        <circle cx={ORBIT_CENTER} cy={ORBIT_CENTER} r={SATELLITE_ORBIT_RADIUS} className={styles.orbit} />

        {slots.map((slot, i) => {
          const overdue = slot.satellite?.overdue === true;
          const name = slot.satellite
            ? `${slot.satellite.title}${overdue ? t(', overdue') : ''}${slot.satellite.dueLabel ? `, ${slot.satellite.dueLabel}` : ''}`
            : t('{overflow} more commitments', { overflow: slot.overflow ?? 0 });
          const handler = slot.satellite
            ? onSatelliteClick && interactiveSatellites
              ? () => onSatelliteClick(slot.satellite!.id)
              : undefined
            : onOverflowClick && interactiveSatellites
              ? onOverflowClick
              : undefined;
          return (
            <SvgHit
              key={slot.satellite?.id ?? 'overflow'}
              x={slot.x}
              y={slot.y}
              hit={20}
              ring={13}
              label={name}
              onActivate={handler}
              {...(handler ? satelliteRoving.itemProps(i) : {})}
            >
              <title>{name}</title>
              {slot.satellite ? (
                overdue ? (
                  <g transform={`translate(${slot.x} ${slot.y})`} className={styles.overdue}>
                    <rect x="-7" y="-7" width="14" height="14" rx="2.5" transform="rotate(45)" />
                    <path d="M0 -3.4V1.2M0 3.6v0.1" className={styles.bang} />
                  </g>
                ) : (
                  <circle cx={slot.x} cy={slot.y} r={7} style={{ fill: typeColor('commitment') }} className={styles.satellite} />
                )
              ) : (
                <g>
                  <circle cx={slot.x} cy={slot.y} r={11} className={styles.more} />
                  {full ? (
                    <text x={slot.x} y={slot.y} className={styles.moreText} textAnchor="middle" dominantBaseline="central">
                      +{slot.overflow}
                    </text>
                  ) : null}
                </g>
              )}
            </SvgHit>
          );
        })}

        {/* The planet. */}
        <SvgHit
          x={ORBIT_CENTER}
          y={ORBIT_CENTER}
          hit={PLANET_RADIUS}
          ring={PLANET_RADIUS + 3}
          label={planetLabel}
          onActivate={onPlanetClick}
        >
          <circle
            cx={ORBIT_CENTER}
            cy={ORBIT_CENTER}
            r={PLANET_RADIUS}
            className={lit ? styles.planet : styles.planetQuiet}
            style={lit ? { fill: planetFill ?? undefined } : undefined}
          />
          <circle cx={ORBIT_CENTER} cy={ORBIT_CENTER} r={PLANET_RADIUS} fill={`url(#${id}-planet)`} className={styles.gloss} />
          <text
            x={ORBIT_CENTER}
            y={ORBIT_CENTER}
            className={styles.value}
            textAnchor="middle"
            dominantBaseline="central"
            style={{ fill: lit ? moodInk(mood) : 'var(--ink)' }}
          >
            {shownValue}
          </text>
        </SvgHit>

        {/* Records on the ring. */}
        <g role={interactiveDots ? 'group' : undefined} aria-label={interactiveDots ? t('Records of the day') : undefined}>
          {dots.map((dot, i) => (
            <SvgHit
              key={dot.entry.id}
              x={dot.x}
              y={dot.y}
              hit={14}
              ring={dotRadius + 4}
              label={`${minutesToClock(dot.entry.minutes)}, ${TYPE_LABELS[dot.entry.kind]}: ${dot.entry.label}`}
              onActivate={interactiveDots ? () => onEntryClick(dot.entry.id) : undefined}
              {...(interactiveDots ? entryRoving.itemProps(i) : {})}
            >
              <title>{`${minutesToClock(dot.entry.minutes)} · ${TYPE_LABELS[dot.entry.kind]} · ${dot.entry.label}`}</title>
              <circle
                cx={dot.x}
                cy={dot.y}
                r={dotRadius}
                className={styles.entry}
                style={{ fill: typeColor(dot.entry.kind), opacity: dot.past ? 1 : 0.35 } as CSSProperties}
              />
            </SvgHit>
          ))}
        </g>

        {/* Now: a cream dot with a halo. */}
        {now ? (
          <g aria-hidden="true" className={styles.now}>
            <circle cx={now.x} cy={now.y} r={11} className={styles.nowHalo} />
            <circle cx={now.x} cy={now.y} r={6} className={styles.nowDot} />
          </g>
        ) : null}
      </svg>
      <figcaption id={`${id}-desc`} className={shared.srOnly}>
        {description.map((line) => (
          <span key={line}>{line} </span>
        ))}
        {satellites.length > MAX_SATELLITES ? t('{MAX_SATELLITES} are shown on the orbit, the rest are under “+{v}”.', { MAX_SATELLITES, v: satellites.length - MAX_SATELLITES }) : ''}
      </figcaption>
    </figure>
  );
}
