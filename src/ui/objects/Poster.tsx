import { forwardRef } from 'react';
import { cx } from '../primitives/cx';
import { MONTHS_NOMINATIVE } from '../viz/calendar';
import { useSvgId } from '../viz/hooks';
import { moodHex } from '../viz/mood';
import { fitFontSize, GLYPH_RATIO, monthDots, wrapLines } from './geometry';
import { ObjectFrame } from './ObjectFrame';
import type { ObjectBaseProps } from './ObjectFrame';
import styles from './objects.module.css';
import { t, msg } from '../../i18n';

export interface PosterStat {
  label: string;
  value: number | string;
}

export interface PosterProps extends ObjectBaseProps {
  /** Month 1…12 and year. */
  month: number;
  year: number;
  /** Mood of each day of the month (index 0 = the 1st), −3…+3 or null. Draws the calendar of dots. */
  moods?: readonly (number | null | undefined)[];
  /** The month in one or two words ("Тихий сентябрь"). Display italic under the title. */
  phrase?: string;
  /** Up to three numbers at the bottom. */
  stats?: readonly PosterStat[];
}

const W = 360;
const H = 640;
const PAD = 20;
const INK = '#F2EDDC';
const INK_2 = '#B6BBD3';
const COLS = 7;
const CELL = 40;
const GRID_X = (W - COLS * CELL) / 2 + CELL / 2;
const GRID_Y = 322;
const WEEKDAYS = [msg('MON'), msg('TUE'), msg('WED'), msg('THU'), msg('FRI'), msg('SAT'), msg('SUN')] as const;

/**
 * The month poster (docs §2.9): 9:16, the month name in Unbounded across the whole width (the size is fitted and the
 * text length pinned, so "СЕНТЯБРЬ" fills the line as "МАЙ" does), a phrase, the days as mood-coloured dots and three
 * numbers. Fixed night colours: a poster is an object and exports the same in both themes.
 */
export const Poster = forwardRef<SVGSVGElement, PosterProps>(function Poster(
  { month, year, moods = [], phrase, stats = [], onSave, saveLabel, maxWidth, className },
  ref,
) {
  const id = useSvgId('poster');
  const name = t(MONTHS_NOMINATIVE[Math.min(11, Math.max(0, month - 1))] ?? '').toUpperCase();
  const width = W - PAD * 2;
  const size = fitFontSize(name, width, { ratio: GLYPH_RATIO.poster, min: 40, max: 120 });
  const dots = monthDots(year, month, moods);
  const known = dots.map((d) => d.mood).filter((m): m is number => typeof m === 'number');
  const average = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  const glow = moodHex(average);
  const phraseLines = phrase ? wrapLines(phrase, width, 36, { ratio: 0.46, maxLines: 2 }).lines : [];
  const shown = stats.slice(0, 3);
  const label = `${t(MONTHS_NOMINATIVE[month - 1] ?? '')} ${year}.${phrase ? ` ${phrase}.` : ''}${shown.map((s) => ` ${s.label}: ${s.value}.`).join('')}`;

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
      <defs>
        <radialGradient id={`${id}-a`} cx="85%" cy="8%" r="75%">
          <stop offset="0" stopColor={glow} stopOpacity="0.5" />
          <stop offset="1" stopColor={glow} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${id}-b`} cx="10%" cy="100%" r="80%">
          <stop offset="0" stopColor="#4B4FD8" stopOpacity="0.45" />
          <stop offset="1" stopColor="#4B4FD8" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} rx="20" fill="#07080F" />
      <rect width={W} height={H} rx="20" fill={`url(#${id}-a)`} />
      <rect width={W} height={H} rx="20" fill={`url(#${id}-b)`} />

      <text x={PAD} y={PAD + 22} fontSize="11" fill={INK_2} className={styles.label}>
        
        {t('Month summary · {year}', { year })}
      </text>
      <text
        x={PAD}
        y={PAD + 34 + size * 0.72}
        fontSize={size}
        fill={INK}
        textLength={width}
        lengthAdjust="spacingAndGlyphs"
        className={styles.poster}
      >
        {name}
      </text>

      {phraseLines.length ? (
        <text fontSize="36" fill={INK} className={styles.displayItalic}>
          {phraseLines.map((line, i) => (
            <tspan key={i} x={PAD} y={PAD + 34 + size * 0.72 + 56 + i * 40}>
              {line}
            </tspan>
          ))}
        </text>
      ) : null}

      <g aria-hidden="true">
        {WEEKDAYS.map((d, i) => (
          <text key={d} x={GRID_X + i * CELL} y={GRID_Y - 22} textAnchor="middle" fontSize="11" fill={INK_2} className={cx(styles.label)}>
            {t(d)}
          </text>
        ))}
        {dots.map((dot) => {
          const x = GRID_X + dot.col * CELL;
          const y = GRID_Y + dot.row * CELL;
          return dot.mood === null ? (
            <circle key={dot.day} cx={x} cy={y} r="4" fill="none" stroke={INK_2} strokeOpacity="0.45" strokeDasharray="1.5 3" />
          ) : (
            <circle key={dot.day} cx={x} cy={y} r={8 + Math.abs(dot.mood)} fill={moodHex(dot.mood)} />
          );
        })}
      </g>

      {shown.map((stat, i) => {
        const x = PAD + (i * width) / Math.max(1, shown.length);
        return (
          <g key={`${stat.label}-${i}`}>
            <text x={x} y={H - 62} fontSize="30" fill={INK} className={styles.mono}>
              {String(stat.value)}
            </text>
            <text x={x} y={H - 38} fontSize="11" fill={INK_2} className={styles.label}>
              {stat.label}
            </text>
          </g>
        );
      })}
    </ObjectFrame>
  );
});
