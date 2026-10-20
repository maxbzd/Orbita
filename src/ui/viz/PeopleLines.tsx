import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { formatDayShort } from '../../domain/dates';
import { timesCount } from '../../domain/counts';
import { cx } from '../primitives/cx';
import { hashString } from './hash';
import { ROLE_LABELS } from './sphere';
import type { SpherePerson } from './PeopleSphere';
import styles from './People.module.css';
import { t } from '../../i18n';

export interface PeopleLinesPerson extends SpherePerson {
  /** When the person was mentioned, as ms since the epoch. */
  mentionTimes: readonly number[];
}

export interface PeopleLinesProps {
  people: readonly PeopleLinesPerson[];
  /** The shared time axis, ms since the epoch. Defaults to the span of all mentions. */
  from?: number;
  to?: number;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  label?: string;
  className?: string;
}

/** 0…1 position of a time on the axis; clamped, and 0 for an empty axis. */
export function axisPosition(time: number, from: number, to: number): number {
  if (!(to > from)) return 0;
  return Math.min(1, Math.max(0, (time - from) / (to - from)));
}

/** Initials of a name: up to two capital letters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? [parts[0]![0], parts[1]![0]] : [parts[0]?.[0]];
  return letters.filter(Boolean).join('').toUpperCase() || '?';
}

/** A hue (0–359) for a name: the same name always gets the same tint. */
export { hashString };

export function nameHue(name: string): number {
  return hashString(name.trim().toLowerCase()) % 360;
}

/**
 * "Линии" (Your Orbit): one row per person — a bubble with initials in a tint taken from the name,
 * the role, and a line on a time axis shared by all rows, one mark for every mention and a ringed
 * mark for the last one. The same data as the sphere, readable as a list.
 */
export function PeopleLines({ people, from, to, selectedId = null, onSelect, label = t('People over time'), className }: PeopleLinesProps) {
  const range = useMemo(() => {
    const all = people.flatMap((p) => p.mentionTimes);
    const lo = from ?? (all.length ? Math.min(...all) : 0);
    const hi = to ?? (all.length ? Math.max(...all) : 0);
    return { lo, hi };
  }, [people, from, to]);

  const ticks = useMemo(() => {
    if (!(range.hi > range.lo)) return [];
    return [0, 0.5, 1].map((t) => {
      const time = range.lo + (range.hi - range.lo) * t;
      return { t, text: formatDayShort(new Date(time).toISOString().slice(0, 10)) };
    });
  }, [range]);

  const rows = useMemo(() => [...people].sort((a, b) => Math.max(0, ...b.mentionTimes) - Math.max(0, ...a.mentionTimes) || a.name.localeCompare(b.name)), [people]);

  return (
    <div className={cx(styles.lines, className)} role="group" aria-label={label}>
      <div className={styles.axis} aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick.t} className={styles.axisTick} style={{ left: `${tick.t * 100}%`, transform: tick.t === 0 ? 'none' : tick.t === 1 ? 'translateX(-100%)' : undefined }}>
            {tick.text}
          </span>
        ))}
      </div>
      {rows.map((person) => {
        const last = person.mentionTimes.length ? Math.max(...person.mentionTimes) : null;
        const hue = nameHue(person.name);
        return (
          <button
            key={person.id}
            type="button"
            className={styles.row}
            aria-pressed={person.id === selectedId}
            onClick={() => onSelect?.(person.id === selectedId ? null : person.id)}
          >
            <span className={styles.who}>
              <span
                className={styles.bubble}
                style={{ '--bubble': `oklch(0.34 0.07 ${hue})`, '--bubble-ink': `oklch(0.95 0.03 ${hue})` } as CSSProperties}
                aria-hidden="true"
              >
                {initials(person.name)}
              </span>
              <span className={styles.whoText}>
                <span className={styles.name}>{person.name}</span>
                <span className={styles.role}>
                  {ROLE_LABELS[person.role]} · {timesCount(person.mentions)}
                </span>
              </span>
            </span>
            <span
              className={styles.track}
              role="img"
              aria-label={last === null ? t('No mentions') : t('Last mention: {formatDayShort}', { formatDayShort: formatDayShort(new Date(last).toISOString().slice(0, 10), { withYear: true }) })}
            >
              <span className={styles.trackLine} />
              {person.mentionTimes.map((time, i) => (
                <span key={`${time}-${i}`} className={cx(styles.mark, time === last && styles.markLast)} style={{ left: `${axisPosition(time, range.lo, range.hi) * 100}%` }} />
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
