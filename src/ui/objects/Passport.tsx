import { forwardRef } from 'react';
import { formatDayShort } from '../../domain/dates';
import type { DayKey } from '../../domain/types';
import { cx } from '../primitives/cx';
import { arcPath } from '../viz/polar';
import { buildMrz, fitFontSize, GLYPH_RATIO, proportionalSweeps } from './geometry';
import { ObjectFrame } from './ObjectFrame';
import type { ObjectBaseProps } from './ObjectFrame';
import styles from './objects.module.css';
import { t } from '../../i18n';

export interface PassportStat {
  label: string;
  value: number;
}

export interface PassportProps extends ObjectBaseProps {
  year: number;
  /** The hero number of the year (records) and what it counts. */
  hero: { value: number; label: string };
  /** Four numbers under the hero; each also draws one arc around it. */
  stats: readonly [PassportStat, PassportStat, PassportStat, PassportStat] | readonly PassportStat[];
  /** Issue date. */
  issuedOn: DayKey;
}

const W = 300;
const H = 400;
const CX = 150;
const CY = 150;
const RADII = [86, 79, 72, 65] as const;

/** Fixed print colours: a passport is an object, it does not change with the theme (and exports the same). */
const NAVY = '#16275A';
const PAPER = '#EAF1EC';
const INK = '#16275A';
const INK_SOFT = '#46557F';
const ARC_COLORS = ['#2459C9', '#BF3B2B', '#8A5A00', '#0A7A6D'] as const;

/**
 * The year passport (docs §2.9): 3:4, dark-blue cover frame, "paper" #EAF1EC, the hero number in the poster face, four
 * numbers (each with its own arc), the issue date and two machine-readable lines built from the real numbers. The
 * lines carry no names or text from the records.
 */
export const Passport = forwardRef<SVGSVGElement, PassportProps>(function Passport(
  { year, hero, stats, issuedOn, onSave, saveLabel, maxWidth, className },
  ref,
) {
  const four = [0, 1, 2, 3].map((i) => stats[i] ?? { label: '—', value: 0 });
  const sweeps = proportionalSweeps(four.map((s) => s.value));
  const heroText = String(Math.max(0, Math.round(hero.value)));
  const heroSize = fitFontSize(heroText, 112, { ratio: GLYPH_RATIO.poster, min: 22, max: 54 });
  const [mrz1, mrz2] = buildMrz({ year, hero: hero.value, stats: four.map((s) => s.value), issuedOn });
  const issued = formatDayShort(issuedOn, { withYear: true })
    .replace(/\s*г\.$/, '')
    .toUpperCase();
  const label = t('Passport {year}. {label}: {heroText}. {v}. Issued {issued}.', { year, label: hero.label, heroText, v: four.map((s) => `${s.label}: ${s.value}`).join(', '), issued });

  return (
    <ObjectFrame
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      label={label}
      onSave={onSave}
      saveLabel={saveLabel}
      maxWidth={maxWidth}
      className={className}
    >
      <rect width={W} height={H} rx="16" fill={NAVY} />
      <rect x="10" y="10" width={W - 20} height={H - 20} rx="9" fill={PAPER} />
      <text x="26" y="38" fontSize="11" fill={INK} className={styles.label}>
        {t('Year passport')}
      </text>
      <text x={W - 26} y="38" fontSize="11" textAnchor="end" fill={INK} className={styles.label}>
        {year}
      </text>
      <line x1="26" y1="48" x2={W - 26} y2="48" stroke={INK} strokeOpacity="0.25" />

      {RADII.map((r, i) => (
        <g key={r}>
          <circle cx={CX} cy={CY + 8} r={r} fill="none" stroke={INK} strokeOpacity="0.1" strokeWidth="4" />
          <path d={arcPath(CX, CY + 8, r, 0, sweeps[i] ?? 0)} fill="none" stroke={ARC_COLORS[i]} strokeWidth="4" strokeLinecap="round" />
        </g>
      ))}
      <text x={CX} y={CY + 8 + heroSize * 0.36} textAnchor="middle" fontSize={heroSize} fill={INK} className={styles.poster}>
        {heroText}
      </text>
      <text x={CX} y={CY + 8 + heroSize * 0.36 + 20} textAnchor="middle" fontSize="11" fill={INK_SOFT} className={styles.label}>
        {hero.label}
      </text>

      {four.map((stat, i) => {
        const x = 26 + (i % 2) * 124;
        const y = 268 + Math.floor(i / 2) * 44;
        return (
          <g key={i}>
            <circle cx={x + 4} cy={y - 14} r="3.5" fill={ARC_COLORS[i]} />
            <text x={x + 14} y={y - 10} fontSize="11" fill={INK_SOFT} className={styles.label}>
              {stat.label}
            </text>
            <text x={x} y={y + 10} fontSize="22" fill={INK} className={styles.mono}>
              {stat.value}
            </text>
          </g>
        );
      })}
      <text x="26" y="350" fontSize="11" fill={INK_SOFT} className={styles.label}>
        
        {t('Issued {issued}', { issued })}
      </text>

      <g aria-hidden="true" fill={INK} className={cx(styles.mono)}>
        <text x="20" y="368" fontSize="10" textLength={W - 40} lengthAdjust="spacingAndGlyphs">
          {mrz1}
        </text>
        <text x="20" y="381" fontSize="10" textLength={W - 40} lengthAdjust="spacingAndGlyphs">
          {mrz2}
        </text>
      </g>
    </ObjectFrame>
  );
});
